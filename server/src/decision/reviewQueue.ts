import type pg from "pg";
import { MinHeap } from "../ds/minHeap.js";

export interface ReviewCase {
  transaction_id: number;
  score: number;
  reasons: string[];
  card_entity: string;
  device_entity: string | null;
  amount: number;
  transaction_dt: number;
  created_at: string;
}

// Open review cases ordered by risk (highest score first), ties by age (oldest first).
// The heap is the in-memory index; PostgreSQL holds the cases and their labels.
export class ReviewQueue {
  private readonly heap = new MinHeap<ReviewCase>();
  private readonly open = new Set<number>();

  constructor(private readonly pool: pg.Pool) {}

  static async load(pool: pg.Pool): Promise<ReviewQueue> {
    const q = new ReviewQueue(pool);
    const { rows } = await pool.query<ReviewCase>(
      `SELECT r.transaction_id, r.score, r.reasons, r.card_entity, r.device_entity,
              t.amount, t.transaction_dt, r.created_at::text AS created_at
       FROM reviews r JOIN transactions t USING (transaction_id)
       WHERE r.status = 'open' ORDER BY r.created_at, r.transaction_id`,
    );
    for (const r of rows) q.push(r);
    return q;
  }

  get size(): number {
    return this.open.size;
  }

  push(c: ReviewCase): void {
    if (this.open.has(c.transaction_id)) return;
    this.open.add(c.transaction_id);
    this.heap.push(c, -c.score);
  }

  top(limit: number): ReviewCase[] {
    return this.heap.peekMany(limit);
  }

  /** Store an analyst label and drop the case from the queue. Returns the case, or null if it is not open. */
  async label(transactionId: number, status: "fraud" | "legit"): Promise<ReviewCase | null> {
    const { rows } = await this.pool.query<{ card_entity: string; device_entity: string | null }>(
      `UPDATE reviews SET status = $2, labeled_at = now()
       WHERE transaction_id = $1 AND status = 'open' RETURNING card_entity, device_entity`,
      [transactionId, status],
    );
    if (rows.length === 0) return null;
    let found: ReviewCase | null = null;
    this.heap.removeWhere((c) => {
      if (c.transaction_id !== transactionId) return false;
      found = c;
      return true;
    });
    this.open.delete(transactionId);
    return found;
  }
}
