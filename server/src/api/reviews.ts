import type { FastifyInstance } from "fastify";
import type { RiskEngine } from "../decision/engine.js";

export function registerReviewRoutes(app: FastifyInstance, engine: RiskEngine): void {
  // Open review cases, highest risk first, ties broken by age (min-heap order).
  app.get<{ Querystring: { limit?: string } }>("/v1/reviews", async (req, reply) => {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return reply.code(400).send({ error: "limit must be an integer from 1 to 500" });
    }
    return { open: engine.reviews.size, cases: engine.reviews.top(limit) };
  });
}
