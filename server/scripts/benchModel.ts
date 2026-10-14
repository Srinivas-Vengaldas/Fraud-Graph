// Model latency alone on CPU: one row per call (the serving pattern), after warm-up.
// Usage: npx tsx scripts/benchModel.ts [modelDir]
import { readFileSync } from "node:fs";
import os from "node:os";
import { encode, OnnxModel } from "../src/model/score.js";
import { upsertResultsSection } from "./resultsMd.js";

const dir = process.argv[2] ?? new URL("../test/fixtures/", import.meta.url).pathname;
const isFixture = dir.includes("fixtures");
const model = await OnnxModel.load(`${dir}/${isFixture ? "parity_model.onnx" : "model.onnx"}`, `${dir}/${isFixture ? "parity_spec.json" : "feature_spec.json"}`);
const rows = JSON.parse(readFileSync(new URL("../test/fixtures/model_parity.json", import.meta.url), "utf8")) as {
  tx: Record<string, unknown>;
  features: Record<string, number | null>;
}[];
const vectors = rows.map((r) => encode(model.spec, r.features, r.tx));
for (let i = 0; i < 500; i++) await model.scoreBatch([vectors[i % vectors.length]!]);
const times: number[] = [];
for (let i = 0; i < 5000; i++) {
  const t0 = performance.now();
  await model.scoreBatch([vectors[i % vectors.length]!]);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.floor(p * (times.length - 1))]!.toFixed(3);
const machine = `${os.cpus()[0]?.model} (${os.cpus().length} cores), ${os.platform()}`;
const body = [
  "## Model latency (CPU, model only)",
  "",
  `Measured by [\`server/scripts/benchModel.ts\`](../server/scripts/benchModel.ts) on ${new Date().toISOString().slice(0, 10)}, ${machine}: ` +
    `${times.length.toLocaleString()} single-row onnxruntime-node calls after warm-up, ${model.spec.features.length} features.`,
  "",
  "| p50 | p95 | p99 |",
  "|---|---|---|",
  `| ${q(0.5)} ms | ${q(0.95)} ms | ${q(0.99)} ms |`,
].join("\n");
upsertResultsSection("model-latency", body);
console.log(body);
