import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Scorer } from "../src/api/score.js";
import { cleanup, connect, testId } from "./helpers.js";

const { pool, redis } = connect();
const ids: number[] = [];

// Slow and random on purpose: if a duplicate ever computed twice, the bodies would differ.
let computeCalls = 0;
const randomScorer: Scorer = {
  async score() {
    computeCalls++;
    await new Promise((r) => setTimeout(r, 50));
    return { verdict: "approve", score: Math.random(), reasons: [], model_version: "test", features: null };
  },
};

const app = buildApp({ pool, redis, scorer: randomScorer });

function tx(id: number, extra: Record<string, unknown> = {}) {
  return { TransactionID: id, TransactionDT: 86_400 + id % 1000, TransactionAmt: 49.5, card1: 1234, ...extra };
}

let base = "";
beforeAll(async () => {
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await cleanup(pool, ids);
  await app.close();
  await pool.end();
  redis.disconnect();
});

describe("POST /v1/score idempotency", () => {
  it("returns one identical decision for parallel duplicates and stores it once", async () => {
    const id = testId();
    ids.push(id);
    const key = randomUUID();
    computeCalls = 0;
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(base).post("/v1/score").set("Idempotency-Key", key).send(tx(id)),
      ),
    );
    for (const r of responses) expect(r.status).toBe(200);
    const bodies = new Set(responses.map((r) => JSON.stringify(r.body)));
    expect(bodies.size).toBe(1);
    expect(computeCalls).toBe(1);
    expect(responses.filter((r) => r.headers["idempotent-replayed"] === "true")).toHaveLength(9);

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM decisions WHERE transaction_id = $1", [id]);
    expect(rows[0].n).toBe(1);

    const again = await request(base).post("/v1/score").set("Idempotency-Key", key).send(tx(id));
    expect(again.body).toEqual(responses[0]!.body);
  });

  it("rejects a reused key with a different body", async () => {
    const id = testId();
    ids.push(id);
    const key = randomUUID();
    await request(base).post("/v1/score").set("Idempotency-Key", key).send(tx(id)).expect(200);
    await request(base).post("/v1/score").set("Idempotency-Key", key).send(tx(id, { TransactionAmt: 1 })).expect(422);
  });

  it("requires the Idempotency-Key header", async () => {
    await request(base).post("/v1/score").send(tx(testId())).expect(400);
  });

  it("rejects a body that carries the label", async () => {
    await request(base).post("/v1/score").set("Idempotency-Key", randomUUID()).send(tx(testId(), { isFraud: 1 })).expect(400);
  });
});

describe("health and metrics", () => {
  it("serves /healthz and /metrics", async () => {
    await request(base).get("/healthz").expect(200, { ok: true });
    const m = await request(base).get("/metrics").expect(200);
    expect(m.text).toContain("fraudgraph_decisions_total");
  });
});
