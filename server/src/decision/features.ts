import type { Transaction } from "../api/schemas.js";
import type { RingInfo } from "../graph/rings.js";
import type { BlocklistHit } from "../rules/blocklist.js";
import type { VelocityFeatures } from "../rules/velocity.js";

// The feature vector the serving path computes and logs to the `features` table.
// Training (ml/train.py) reads these logged values, so the model sees exactly
// what the API computed. Raw request columns are joined separately at training
// time and passed through unchanged at serving time.
export type FeatureVector = Record<string, number | null>;

export function buildFeatures(
  tx: Transaction,
  vel: VelocityFeatures,
  ring: RingInfo,
  hits: BlocklistHit[],
  hasDevice: boolean,
): FeatureVector {
  return {
    ...vel,
    ring_size: ring.ring_size,
    ring_fraud_entities: ring.ring_fraud_entities,
    ring_fraud_others: ring.ring_fraud_others,
    blocklist_card: hits.some((h) => h.entity_type === "card") ? 1 : 0,
    blocklist_device: hits.some((h) => h.entity_type === "device") ? 1 : 0,
    has_device: hasDevice ? 1 : 0,
    amt_share_card_24h: vel.card_amt_24h > 0 ? round4(tx.TransactionAmt / vel.card_amt_24h) : null,
  };
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
