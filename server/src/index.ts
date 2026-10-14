import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";
import { RiskEngine } from "./decision/engine.js";

const pool = createPool(config.databaseUrl());
const redis = new Redis(config.redisUrl());
const log = (msg: string) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg }));

const engine = await RiskEngine.create(pool, {
  degreeCap: config.degreeCap,
  policy: { mode: config.policyMode, reviewThreshold: config.reviewThreshold, declineThreshold: config.declineThreshold },
  log,
});
log(`engine ready: ${engine.blocklist.size} blocklist entries, ${engine.reviews.size} open reviews, degree cap ${config.degreeCap ?? "none"}`);

const app = buildApp({ pool, redis, engine, idempotencyTtlSec: config.idempotencyTtlSec, logger: true });

const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
