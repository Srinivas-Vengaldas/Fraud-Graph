import { readFileSync } from "node:fs";
import ort from "onnxruntime-node";
import type { Transaction } from "../api/schemas.js";
import type { FeatureVector } from "../decision/features.js";
import type { ModelScorer } from "../decision/engine.js";

// LightGBM exported to ONNX (ml/export_onnx.py), scored on CPU with onnxruntime-node.
// The feature spec written at training time fixes the column order and category
// codes, so this builds the same vector as ml/dataset.py:encode().

export interface FeatureSpec {
  features: string[];
  categorical: Record<string, string[]>;
  missing_category: number;
}

const DAY = 86_400;
const num = (v: unknown) => (typeof v === "number" ? v : NaN);

// Features computed from raw request fields; twin of ml/dataset.py:add_derived().
export function derived(tx: Partial<Transaction>): Record<string, number> {
  const t = num(tx.TransactionDT);
  const amt = num(tx.TransactionAmt);
  const p = tx.P_emaildomain;
  const r = tx.R_emaildomain;
  return {
    hour_of_day: Math.floor((t % DAY) / 3600),
    amt_cents: Math.round((amt - Math.floor(amt)) * 1000) / 1000,
    card_birth_day: Math.floor(t / DAY - num(tx.D1)),
    email_match: p == null || r == null ? NaN : p === r ? 1 : 0,
  };
}

export function encode(spec: FeatureSpec, features: FeatureVector, tx: Partial<Transaction>): Float32Array {
  const out = new Float32Array(spec.features.length);
  const raw = { ...(tx as Record<string, unknown>), ...derived(tx) };
  spec.features.forEach((name, i) => {
    const cats = spec.categorical[name];
    if (cats) {
      const v = raw[name];
      const idx = v === null || v === undefined ? -1 : cats.indexOf(String(v));
      out[i] = idx >= 0 ? idx : spec.missing_category;
      return;
    }
    const v = name in features ? features[name] : raw[name];
    out[i] = typeof v === "number" ? v : NaN; // LightGBM treats NaN as missing
  });
  return out;
}

export class OnnxModel implements ModelScorer {
  private constructor(
    private readonly session: ort.InferenceSession,
    readonly spec: FeatureSpec,
    readonly version: string,
  ) {}

  static async load(modelPath: string, specPath: string, version?: string): Promise<OnnxModel> {
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      intraOpNumThreads: 1,
      graphOptimizationLevel: "all",
    });
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as FeatureSpec;
    return new OnnxModel(session, spec, version ?? `lgbm-onnx@${modelPath.split("/").pop()}`);
  }

  async score(features: FeatureVector, tx: Partial<Transaction>): Promise<number> {
    return (await this.scoreBatch([encode(this.spec, features, tx)]))[0]!;
  }

  async scoreBatch(rows: Float32Array[]): Promise<number[]> {
    const n = this.spec.features.length;
    const data = new Float32Array(rows.length * n);
    rows.forEach((r, i) => data.set(r, i * n));
    const input = new ort.Tensor("float32", data, [rows.length, n]);
    const out = await this.session.run({ input });
    // Outputs: "label" and "probabilities" [batch, 2]; column 1 is P(fraud).
    const probs = out["probabilities"]!.data as Float32Array;
    return Array.from({ length: rows.length }, (_, i) => probs[i * 2 + 1]!);
  }
}
