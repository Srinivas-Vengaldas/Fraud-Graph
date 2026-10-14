import type pg from "pg";
import type { Decision, Transaction } from "../api/schemas.js";
import type { ReviewRow } from "../api/score.js";

const int = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.trunc(v));

export async function saveScored(
  pool: pg.Pool,
  tx: Transaction,
  decision: Decision,
  features: Record<string, number | null> | null,
  review: ReviewRow | null = null,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO transactions (transaction_id, transaction_dt, amount, product_cd, card1, card2, card3, card4,
         card5, card6, addr1, addr2, p_emaildomain, r_emaildomain, d1, device_type, device_info, id_30, id_31, id_33)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        tx.TransactionID, tx.TransactionDT, tx.TransactionAmt, tx.ProductCD ?? null,
        int(tx.card1), int(tx.card2), int(tx.card3), tx.card4 ?? null, int(tx.card5), tx.card6 ?? null,
        int(tx.addr1), int(tx.addr2), tx.P_emaildomain ?? null, tx.R_emaildomain ?? null, tx.D1 ?? null,
        tx.DeviceType ?? null, tx.DeviceInfo ?? null, tx.id_30 ?? null, tx.id_31 ?? null, tx.id_33 ?? null,
      ],
    );
    await client.query(
      `INSERT INTO decisions (transaction_id, verdict, score, reasons, latency_ms, model_version)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (transaction_id) DO NOTHING`,
      [decision.transaction_id, decision.verdict, decision.score, JSON.stringify(decision.reasons),
       decision.latency_ms, decision.model_version],
    );
    if (features) {
      await client.query(
        `INSERT INTO features (transaction_id, features, model_version) VALUES ($1,$2,$3)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [tx.TransactionID, JSON.stringify(features), decision.model_version],
      );
    }
    if (review) {
      await client.query(
        `INSERT INTO reviews (transaction_id, score, reasons, card_entity, device_entity) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [review.transaction_id, review.score, JSON.stringify(review.reasons), review.card_entity, review.device_entity],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
