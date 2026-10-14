import { Redis } from "ioredis";
import { config } from "../src/config.js";
import { createPool } from "../src/db/pool.js";

export function connect() {
  const pool = createPool(config.databaseUrl());
  const redis = new Redis(config.redisUrl());
  return { pool, redis };
}

// Test rows use ids far above the dataset range so they never collide with replayed data.
let next = 9_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1000;
export const testId = () => next++;

export async function cleanup(pool: import("pg").Pool, ids: number[]) {
  if (ids.length === 0) return;
  await pool.query("DELETE FROM features WHERE transaction_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM decisions WHERE transaction_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM transactions WHERE transaction_id = ANY($1)", [ids]);
}
