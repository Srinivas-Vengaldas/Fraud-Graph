// Request and response schemas for POST /v1/score.
// Field names follow the IEEE-CIS columns so the replay harness can send rows as-is.
// isFraud is deliberately absent and additionalProperties is false, so a body that
// carries the label is rejected with 400.

const str = { type: ["string", "null"] } as const;
const num = { type: ["number", "null"] } as const;

export const transactionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["TransactionID", "TransactionDT", "TransactionAmt"],
  properties: {
    TransactionID: { type: "integer", minimum: 0 },
    TransactionDT: { type: "integer", minimum: 0 },
    TransactionAmt: { type: "number", minimum: 0 },
    ProductCD: str,
    card1: num,
    card2: num,
    card3: num,
    card4: str,
    card5: num,
    card6: str,
    addr1: num,
    addr2: num,
    dist1: num,
    dist2: num,
    P_emaildomain: str,
    R_emaildomain: str,
    ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`C${i + 1}`, num])),
    ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`D${i + 1}`, num])),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`M${i + 1}`, str])),
    DeviceType: str,
    DeviceInfo: str,
    id_30: str,
    id_31: str,
    id_33: str,
  },
} as const;

export interface Transaction {
  TransactionID: number;
  TransactionDT: number;
  TransactionAmt: number;
  ProductCD?: string | null;
  card1?: number | null;
  card2?: number | null;
  card3?: number | null;
  card4?: string | null;
  card5?: number | null;
  card6?: string | null;
  addr1?: number | null;
  addr2?: number | null;
  dist1?: number | null;
  dist2?: number | null;
  P_emaildomain?: string | null;
  R_emaildomain?: string | null;
  // C1-C14 and D1-D15 (masked counts and time deltas), M1-M9 (masked match flags)
  [key: `C${number}` | `D${number}` | `M${number}`]: number | string | null | undefined;
  D1?: number | null;
  DeviceType?: string | null;
  DeviceInfo?: string | null;
  id_30?: string | null;
  id_31?: string | null;
  id_33?: string | null;
}

export type Verdict = "approve" | "review" | "decline";

export interface Decision {
  transaction_id: number;
  verdict: Verdict;
  score: number | null;
  reasons: string[];
  model_version: string;
  latency_ms: number;
}

export const decisionSchema = {
  type: "object",
  required: ["transaction_id", "verdict", "reasons", "model_version", "latency_ms"],
  properties: {
    transaction_id: { type: "integer" },
    verdict: { type: "string", enum: ["approve", "review", "decline"] },
    score: { type: ["number", "null"] },
    reasons: { type: "array", items: { type: "string" } },
    model_version: { type: "string" },
    latency_ms: { type: "number" },
  },
} as const;
