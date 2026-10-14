import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { encode, OnnxModel } from "../src/model/score.js";

interface Row {
  tx: Record<string, string | number | null>;
  features: Record<string, number | null>;
  score: number;
}

// Written by `python ml/export_onnx.py`: holdout rows with the Python LightGBM score.
const fixture = (f: string) => new URL(`./fixtures/${f}`, import.meta.url).pathname;
const rows: Row[] = JSON.parse(readFileSync(fixture("model_parity.json"), "utf8"));

let model: OnnxModel;
beforeAll(async () => {
  model = await OnnxModel.load(fixture("parity_model.onnx"), fixture("parity_spec.json"), "parity");
});

describe("ONNX model in Node matches LightGBM in Python", () => {
  it("covers 1,000 rows", () => {
    expect(rows).toHaveLength(1000);
  });

  it("agrees within 1e-5 on every row", async () => {
    const scores = await model.scoreBatch(rows.map((r) => encode(model.spec, r.features, r.tx)));
    const diffs = rows.map((r, i) => Math.abs(r.score - scores[i]!));
    const worst = Math.max(...diffs);
    console.log(`max |python - node| = ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(1e-5);
  });

  it("scores one row at a time the same as in a batch", async () => {
    const r = rows[0]!;
    expect(await model.score(r.features, r.tx)).toBeCloseTo(r.score, 5);
  });

  it("maps unknown and missing categories to -1", () => {
    const v = encode(model.spec, {}, { ProductCD: "never-seen", card4: null });
    expect(v[model.spec.features.indexOf("ProductCD")]).toBe(-1);
    expect(v[model.spec.features.indexOf("card4")]).toBe(-1);
  });
});
