import client from "prom-client";

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  return {
    registry,
    scoreLatency: new client.Histogram({
      name: "fraudgraph_score_latency_ms",
      help: "End-to-end scoring latency in milliseconds (excludes idempotent replays)",
      buckets: [1, 2, 5, 10, 20, 50, 100, 250, 500],
      registers: [registry],
    }),
    decisions: new client.Counter({
      name: "fraudgraph_decisions_total",
      help: "Decisions by verdict",
      labelNames: ["verdict"] as const,
      registers: [registry],
    }),
    replays: new client.Counter({
      name: "fraudgraph_idempotent_replays_total",
      help: "Requests answered from the idempotency store",
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
