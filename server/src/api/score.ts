import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { Metrics } from "../metrics.js";
import { saveScored } from "../db/queries.js";
import type { IdempotencyStore } from "./idempotency.js";
import { decisionSchema, transactionSchema, type Decision, type Transaction, type Verdict } from "./schemas.js";

export interface ScoreResult {
  verdict: Verdict;
  score: number | null;
  reasons: string[];
  model_version: string;
  features: Record<string, number | null> | null;
  review?: ReviewRow | null;
  onCommit?: () => void; // runs after the decision is durably stored
}

export interface ReviewRow {
  transaction_id: number;
  score: number;
  reasons: string[];
  card_entity: string;
  device_entity: string | null;
}

export interface Scorer {
  score(tx: Transaction): Promise<ScoreResult> | ScoreResult;
}

export const placeholderScorer: Scorer = {
  score: () => ({
    verdict: "approve",
    score: null,
    reasons: ["placeholder: scoring not implemented yet"],
    model_version: "none",
    features: null,
  }),
};

export interface ScoreRouteDeps {
  pool: pg.Pool;
  idempotency: IdempotencyStore;
  scorer: Scorer;
  metrics: Metrics;
}

export function registerScoreRoutes(app: FastifyInstance, deps: ScoreRouteDeps): void {
  app.post<{ Body: Transaction; Headers: { "idempotency-key"?: string } }>(
    "/v1/score",
    {
      schema: {
        body: transactionSchema,
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", minLength: 1, maxLength: 200 } },
        },
        response: { 200: decisionSchema },
      },
    },
    async (req, reply) => {
      const key = req.headers["idempotency-key"]!;
      const tx = req.body;
      const result = await deps.idempotency.run<Decision>(key, tx, async () => {
        const t0 = performance.now();
        const r = await deps.scorer.score(tx);
        const decision: Decision = {
          transaction_id: tx.TransactionID,
          verdict: r.verdict,
          score: r.score,
          reasons: r.reasons,
          model_version: r.model_version,
          latency_ms: 0,
        };
        decision.latency_ms = Math.round((performance.now() - t0) * 1000) / 1000;
        await saveScored(deps.pool, tx, decision, r.features, r.review ?? null);
        r.onCommit?.();
        deps.metrics.scoreLatency.observe(performance.now() - t0);
        deps.metrics.decisions.inc({ verdict: decision.verdict });
        return decision;
      });

      switch (result.kind) {
        case "fresh":
          return result.body;
        case "replayed":
          deps.metrics.replays.inc();
          reply.header("idempotent-replayed", "true");
          return result.body;
        case "conflict":
          return reply.code(422).send({ error: "Idempotency-Key reused with a different request body" });
        case "in_progress":
          return reply.code(409).send({ error: "A request with this Idempotency-Key is still being processed" });
      }
    },
  );
}
