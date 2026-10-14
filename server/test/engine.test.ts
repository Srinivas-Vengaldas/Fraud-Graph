import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { applyRules, combine, DEFAULT_POLICY, RiskEngine } from "../src/decision/engine.js";
import { cleanup, connect, testId } from "./helpers.js";

const { pool, redis } = connect();
const ids: number[] = [];
const tag = Math.floor(Math.random() * 1e6);
// card1 values far outside the dataset's 1000-18396 range so tests never collide with replayed data.
const card1 = (i: number) => 900_000_000 + tag * 10 + i;

beforeAll(async () => {
  // Card 0 has a blocklist entry that only takes effect at day 10.
  await pool.query(
    "INSERT INTO blocklist (entity_type, entity_key, reason, effective_dt) VALUES ('card', $1, 'test: prior fraud', $2)",
    [`${card1(0)}|100|0`, 10 * 86_400],
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM reviews WHERE transaction_id = ANY($1)", [ids]);
  await cleanup(pool, ids);
  await pool.query("DELETE FROM blocklist WHERE entity_key LIKE $1", [`${card1(0)}|%`]);
  await pool.end();
  redis.disconnect();
});

const tx = (c: number, day: number, extra: Record<string, unknown> = {}) => {
  const id = testId();
  ids.push(id);
  return { TransactionID: id, TransactionDT: Math.round(day * 86_400), TransactionAmt: 100, card1: card1(c), addr1: 100, D1: Math.floor(day), ...extra };
};

describe("rules", () => {
  it("approve with no signals, decline on a card blocklist hit, review on velocity", () => {
    const quiet = { card_tx_1h: 1, card_tx_24h: 1, card_amt_1h: 10, card_amt_24h: 10, device_tx_1h: null, device_tx_24h: null, device_amt_1h: null, device_amt_24h: null, device_cards_24h: null };
    expect(applyRules(quiet, { ring_size: 1, ring_fraud_others: 0 }, []).verdict).toBe("approve");
    expect(applyRules(quiet, { ring_size: 1, ring_fraud_others: 0 }, [{ entity_type: "card", entity_key: "k", reason: "r" }]).verdict).toBe("decline");
    const busy = applyRules({ ...quiet, device_cards_24h: 7 }, { ring_size: 1, ring_fraud_others: 0 }, []);
    expect(busy.verdict).toBe("review");
    expect(busy.reasons).toEqual(["device linked to 7 card entities in 24 h"]);
  });

  it("combines rules and model by the more severe verdict", () => {
    const rules = { verdict: "review" as const, reasons: ["x"], score: 0.5 };
    expect(combine(rules, 0.95, { ...DEFAULT_POLICY, mode: "rules+model" }).verdict).toBe("decline");
    expect(combine(rules, 0.1, { ...DEFAULT_POLICY, mode: "rules+model" }).verdict).toBe("review");
    expect(combine(rules, 0.1, { ...DEFAULT_POLICY, mode: "model" }).verdict).toBe("approve");
    expect(combine(rules, 0.1, DEFAULT_POLICY).verdict).toBe("review");
  });
});

describe("RiskEngine through the API", () => {
  let base = "";
  let engine: RiskEngine;
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    engine = await RiskEngine.create(pool, { degreeCap: 50 });
    app = buildApp({ pool, redis, engine });
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await app.close();
  });
  const score = (body: object) => request(base).post("/v1/score").set("Idempotency-Key", randomUUID()).send(body);

  it("uses a blocklist entry only after its label exists in event time", async () => {
    // Card 0's birth day is day - D1 = 0 for every transaction below.
    const before = await score(tx(0, 5));
    expect(before.body.verdict).toBe("approve");
    const after = await score(tx(0, 11));
    expect(after.body.verdict).toBe("decline");
    expect(after.body.reasons[0]).toContain("card entity on blocklist");
  });

  it("flags a ring that reaches a card with prior fraud, queues it, and logs features", async () => {
    const dev = { DeviceInfo: `test-device-${tag}`, id_30: "Android 8", id_31: "chrome", id_33: "720x1280" };
    await score(tx(0, 12, dev)); // the blocklisted card uses the device
    await score(tx(1, 12.01, dev));
    const r = await score(tx(2, 12.02, dev));
    expect(r.body.verdict).toBe("review");
    expect(r.body.reasons.join(" ")).toMatch(/identity ring of 4 entities includes \d+ with prior fraud/);

    expect(engine.reviews.top(engine.reviews.size).map((c) => c.transaction_id)).toContain(r.body.transaction_id);
    const q = await request(base).get("/v1/reviews?limit=500").expect(200);
    const scores = q.body.cases.map((c: { score: number }) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    const { rows } = await pool.query("SELECT features FROM features WHERE transaction_id = $1", [r.body.transaction_id]);
    expect(rows[0].features.ring_size).toBe(4);
    expect(rows[0].features.device_cards_24h).toBe(3);
  });

  it("labels a case, blocklists its card, and serves its ring", async () => {
    const [top] = engine.reviews.top(engine.reviews.size).filter((c) => ids.includes(c.transaction_id));
    expect(top).toBeDefined();
    const ring = await request(base).get(`/v1/rings/card/${encodeURIComponent(top!.card_entity)}?hops=2&limit=50`).expect(200);
    expect(ring.body.nodes.length).toBeGreaterThanOrEqual(2);
    expect(ring.body.ring.ring_size).toBe(4);

    await request(base).post(`/v1/reviews/${top!.transaction_id}`).send({ label: "maybe" }).expect(400);
    const res = await request(base).post(`/v1/reviews/${top!.transaction_id}`).send({ label: "fraud" });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("fraud");
    await request(base).post(`/v1/reviews/${top!.transaction_id}`).send({ label: "fraud" }).expect(404);
    const hits = await engine.blocklist.check([{ type: "card", key: top!.card_entity }]);
    expect(hits).toHaveLength(1);
    await pool.query("DELETE FROM blocklist WHERE entity_key = ANY($1)", [[top!.card_entity, top!.device_entity]]);
  });

  it("flags card velocity with a readable reason", async () => {
    let last;
    for (let i = 0; i < 4; i++) last = await score(tx(3, 20 + i / 1000));
    expect(last!.body.verdict).toBe("review");
    expect(last!.body.reasons).toContain("4 transactions on this card in 1 h");
  });
});
