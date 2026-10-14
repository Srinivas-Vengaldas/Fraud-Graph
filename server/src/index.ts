import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";

const pool = createPool(config.databaseUrl());
const redis = new Redis(config.redisUrl());
const app = buildApp({ pool, redis, idempotencyTtlSec: config.idempotencyTtlSec, logger: true });

const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
