import type pg from "pg";
import { BloomFilter } from "../ds/bloomFilter.js";

export type EntityType = "card" | "device";

export interface BlocklistHit {
  entity_type: EntityType;
  entity_key: string;
  reason: string;
}

// Cheapest check first: an in-memory Bloom filter screens every entity, and only
// the rare "maybe" goes to PostgreSQL for confirmation. A Bloom positive alone
// never blocks anything.
export class Blocklist {
  bloomHits = 0;
  confirmedHits = 0;

  private constructor(
    private readonly pool: pg.Pool,
    private readonly bloom: BloomFilter,
  ) {}

  static async load(pool: pg.Pool, p = 0.001): Promise<Blocklist> {
    const { rows } = await pool.query<{ entity_type: EntityType; entity_key: string }>(
      "SELECT entity_type, entity_key FROM blocklist",
    );
    // Leave headroom so entries added while running keep the rate near p.
    const bloom = new BloomFilter(Math.max(1000, rows.length * 2), p);
    for (const r of rows) bloom.add(`${r.entity_type}:${r.entity_key}`);
    return new Blocklist(pool, bloom);
  }

  get size(): number {
    return this.bloom.size;
  }

  async check(entities: { type: EntityType; key: string }[]): Promise<BlocklistHit[]> {
    const maybe = entities.filter((e) => this.bloom.mightContain(`${e.type}:${e.key}`));
    if (maybe.length === 0) return [];
    this.bloomHits += maybe.length;
    const { rows } = await this.pool.query<BlocklistHit>(
      `SELECT entity_type, entity_key, reason FROM blocklist
       WHERE (entity_type, entity_key) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [maybe.map((e) => e.type), maybe.map((e) => e.key)],
    );
    this.confirmedHits += rows.length;
    return rows;
  }

  async add(type: EntityType, key: string, reason: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO blocklist (entity_type, entity_key, reason) VALUES ($1, $2, $3)
       ON CONFLICT (entity_type, entity_key) DO NOTHING`,
      [type, key, reason],
    );
    this.bloom.add(`${type}:${key}`);
  }
}
