import { existsSync, readFileSync } from "node:fs";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";
import { RiskEngine, type Policy } from "./decision/engine.js";
import { OnnxModel } from "./model/score.js";

const pool = createPool(config.databaseUrl());
const redis = new Redis(config.redisUrl());
const log = (msg: string) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg }));

const modelPath = `${config.modelDir}/model.onnx`;
const trainedAt = existsSync(`${config.modelDir}/train_meta.json`)
  ? (JSON.parse(readFileSync(`${config.modelDir}/train_meta.json`, "utf8")) as { commit: string }).commit
  : "unknown";
const model = existsSync(modelPath)
  ? await OnnxModel.load(modelPath, `${config.modelDir}/feature_spec.json`, `lgbm@${trainedAt}`)
  : null;
const saved = existsSync(`${config.modelDir}/thresholds.json`)
  ? (JSON.parse(readFileSync(`${config.modelDir}/thresholds.json`, "utf8")) as {
      review_threshold: number;
      decline_threshold: number;
      analyst_capacity_share?: number;
    })
  : null;
const policy: Policy = {
  mode: config.policyMode ?? (model ? "rules+model" : "rules"),
  reviewThreshold: config.reviewThreshold ?? saved?.review_threshold ?? 0.5,
  declineThreshold: config.declineThreshold ?? saved?.decline_threshold ?? 0.9,
};

const reviewCapacityShare = config.reviewCapacityShare === undefined ? (saved?.analyst_capacity_share ?? null) : config.reviewCapacityShare;
const engine = await RiskEngine.create(pool, { degreeCap: config.degreeCap, policy, model, reviewCapacityShare, log });
const t0 = performance.now();
const warmed = await engine.warmUp(pool);
log(`warm-up: rebuilt velocity windows and ring graph from ${warmed} stored transactions in ${(performance.now() - t0).toFixed(0)} ms`);
log(
  `engine ready: ${engine.blocklist.size} blocklist entries, ${engine.reviews.size} open reviews, ` +
    `degree cap ${config.degreeCap ?? "none"}, policy ${policy.mode} (review >= ${policy.reviewThreshold.toFixed(3)}, ` +
    `decline >= ${policy.declineThreshold.toFixed(3)}), model ${model ? model.version : "none"}, ` +
    `review capacity ${reviewCapacityShare === null ? "unlimited" : `${(reviewCapacityShare * 100).toFixed(1)}% of daily volume`}`,
);

const app = buildApp({ pool, redis, engine, idempotencyTtlSec: config.idempotencyTtlSec, logger: { level: process.env.LOG_LEVEL ?? "info" }, webDir: config.webDir });

const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
