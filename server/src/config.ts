import { config as loadEnv } from "dotenv";

// Repo-root .env (server/src -> ../../.env, also valid from server/dist).
loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.API_PORT ?? 3000),
  host: process.env.API_HOST ?? "0.0.0.0",
  databaseUrl: () => required("DATABASE_URL"),
  redisUrl: () => required("REDIS_URL"),
  idempotencyTtlSec: Number(process.env.IDEMPOTENCY_TTL_SEC ?? 24 * 3600),
  // Ring graph: nodes with more distinct neighbors than this are cut. "none" disables the cap.
  degreeCap: process.env.DEGREE_CAP === "none" ? null : Number(process.env.DEGREE_CAP ?? 50),
  // Default: "rules+model" when a model is found in modelDir, otherwise "rules".
  policyMode: process.env.POLICY_MODE as "rules" | "model" | "rules+model" | undefined,
  // Thresholds default to ml/artifacts/thresholds.json (chosen by ml/costs.py).
  reviewThreshold: process.env.REVIEW_THRESHOLD ? Number(process.env.REVIEW_THRESHOLD) : undefined,
  declineThreshold: process.env.DECLINE_THRESHOLD ? Number(process.env.DECLINE_THRESHOLD) : undefined,
  // Daily review capacity as a share of volume; defaults to thresholds.json, "none" = unlimited.
  reviewCapacityShare:
    process.env.REVIEW_CAPACITY_SHARE === "none" ? null : process.env.REVIEW_CAPACITY_SHARE ? Number(process.env.REVIEW_CAPACITY_SHARE) : undefined,
  webDir: process.env.WEB_DIR ?? new URL("../../web/dist", import.meta.url).pathname,
  modelDir: process.env.MODEL_DIR ?? new URL("../../ml/artifacts", import.meta.url).pathname,
};
