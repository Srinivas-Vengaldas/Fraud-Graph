import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Blocklist } from "../src/rules/blocklist.js";
import { connect } from "./helpers.js";

const { pool, redis } = connect();
const prefix = `test-${randomUUID()}`;

afterAll(async () => {
  await pool.query("DELETE FROM blocklist WHERE entity_key LIKE $1", [`${prefix}%`]);
  await pool.end();
  redis.disconnect();
});

describe("Blocklist (Bloom filter + PostgreSQL confirm)", () => {
  it("confirms real entries and ignores everything else", async () => {
    await pool.query(
      "INSERT INTO blocklist (entity_type, entity_key, reason) VALUES ('card', $1, 'prior fraud'), ('device', $2, 'prior fraud')",
      [`${prefix}|card`, `${prefix}|device`],
    );
    const bl = await Blocklist.load(pool);
    const hits = await bl.check([
      { type: "card", key: `${prefix}|card` },
      { type: "device", key: `${prefix}|device` },
      { type: "card", key: `${prefix}|clean` },
      { type: "device", key: `${prefix}|card` }, // right key, wrong type
    ]);
    expect(hits.map((h) => `${h.entity_type}:${h.entity_key}`).sort()).toEqual(
      [`card:${prefix}|card`, `device:${prefix}|device`].sort(),
    );
  });

  it("sees entries added at runtime", async () => {
    const bl = await Blocklist.load(pool);
    await bl.add("card", `${prefix}|late`, "analyst label");
    expect(await bl.check([{ type: "card", key: `${prefix}|late` }])).toHaveLength(1);
  });
});
