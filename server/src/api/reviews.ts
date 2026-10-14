import type { FastifyInstance } from "fastify";
import type { RiskEngine } from "../decision/engine.js";
import { node, type NodeType } from "../graph/rings.js";

export function registerReviewRoutes(app: FastifyInstance, engine: RiskEngine): void {
  // Open review cases, highest risk first, ties broken by age (min-heap order).
  app.get<{ Querystring: { limit?: string } }>("/v1/reviews", async (req, reply) => {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return reply.code(400).send({ error: "limit must be an integer from 1 to 500" });
    }
    return { open: engine.reviews.size, cases: engine.reviews.top(limit) };
  });

  // Analyst label. "fraud" also blocklists the case's entities and marks them in the ring graph.
  app.post<{ Params: { id: string }; Body: { label: "fraud" | "legit" } }>(
    "/v1/reviews/:id",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "string", pattern: "^[0-9]+$" } } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: { label: { type: "string", enum: ["fraud", "legit"] } },
        },
      },
    },
    async (req, reply) => {
      const id = Number(req.params.id);
      const c = await engine.reviews.label(id, req.body.label);
      if (!c) return reply.code(404).send({ error: "no open review for this transaction" });
      if (req.body.label === "fraud") {
        await engine.labelFraud(c.card_entity, c.device_entity, `analyst: confirmed fraud on transaction ${id}`);
      }
      return { transaction_id: id, label: req.body.label, open: engine.reviews.size };
    },
  );

  // Ring explorer: BFS from an entity, limited by hops and node count.
  app.get<{ Params: { type: string; key: string }; Querystring: { hops?: string; limit?: string } }>(
    "/v1/rings/:type/:key",
    async (req, reply) => {
      const { type, key } = req.params;
      if (type !== "card" && type !== "device") return reply.code(400).send({ error: "type must be card or device" });
      const hops = Math.min(4, Math.max(1, Number(req.query.hops ?? 2) || 2));
      const limit = Math.min(300, Math.max(2, Number(req.query.limit ?? 100) || 100));
      const n = node(type as NodeType, key);
      return { entity: n, ring: engine.rings.ring(n), ...engine.rings.bfs(n, hops, limit), hops, limit };
    },
  );
}
