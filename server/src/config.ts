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
};
