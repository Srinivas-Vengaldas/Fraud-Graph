import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

// Exactly-once decisions under client retries and parallel duplicates.
//
// The first request for a key wins an atomic SET NX and writes a short-lived
// "pending" marker. It computes the decision and replaces the marker with the
// stored response (full TTL). Any concurrent or later request with the same key
// never computes: it waits for the stored response and returns it verbatim.
// A different body under the same key is a client bug and gets 422.

interface Pending {
  state: "pending";
  fp: string;
}
interface Done<T> {
  state: "done";
  fp: string;
  body: T;
}
type Entry<T> = Pending | Done<T>;

export type IdempotentResult<T> =
  | { kind: "fresh"; body: T }
  | { kind: "replayed"; body: T }
  | { kind: "conflict" } // same key, different body
  | { kind: "in_progress" }; // original still computing after waitMs

export function fingerprint(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class IdempotencyStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSec = 24 * 3600,
    private readonly pendingTtlSec = 30,
    private readonly waitMs = 5000,
  ) {}

  private k(key: string) {
    return `idem:${key}`;
  }

  async run<T>(key: string, body: unknown, compute: () => Promise<T>): Promise<IdempotentResult<T>> {
    const fp = fingerprint(body);
    const deadline = Date.now() + this.waitMs;
    for (;;) {
      const pending: Pending = { state: "pending", fp };
      const won = await this.redis.set(this.k(key), JSON.stringify(pending), "EX", this.pendingTtlSec, "NX");
      if (won === "OK") {
        try {
          const result = await compute();
          const done: Done<T> = { state: "done", fp, body: result };
          await this.redis.set(this.k(key), JSON.stringify(done), "EX", this.ttlSec);
          return { kind: "fresh", body: result };
        } catch (err) {
          await this.redis.del(this.k(key)); // let a retry recompute
          throw err;
        }
      }
      const raw = await this.redis.get(this.k(key));
      if (raw === null) continue; // winner failed and released the key; try to win it
      const entry = JSON.parse(raw) as Entry<T>;
      if (entry.fp !== fp) return { kind: "conflict" };
      if (entry.state === "done") return { kind: "replayed", body: entry.body };
      if (Date.now() > deadline) return { kind: "in_progress" };
      await sleep(5 + Math.random() * 10);
    }
  }
}
