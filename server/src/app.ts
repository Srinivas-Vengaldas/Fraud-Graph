import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type pg from "pg";
import { IdempotencyStore } from "./api/idempotency.js";
import { placeholderScorer, registerScoreRoutes, type Scorer } from "./api/score.js";
import { createMetrics, type Metrics } from "./metrics.js";

export interface AppDeps {
  pool: pg.Pool;
  redis: Redis;
  scorer?: Scorer;
  metrics?: Metrics;
  idempotencyTtlSec?: number;
  logger?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    // Reject unknown fields (e.g. isFraud) instead of silently stripping them.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });
  const metrics = deps.metrics ?? createMetrics();
  const idempotency = new IdempotencyStore(deps.redis, deps.idempotencyTtlSec);

  app.get("/healthz", async () => {
    await deps.pool.query("SELECT 1");
    await deps.redis.ping();
    return { ok: true };
  });

  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  registerScoreRoutes(app, { pool: deps.pool, idempotency, scorer: deps.scorer ?? placeholderScorer, metrics });
  return app;
}
