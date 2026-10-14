import { murmur3 } from "./hash.js";

// Bloom filter sized for n items at false-positive rate p.
//   m = -n ln(p) / (ln 2)^2      bits
//   k = (m / n) ln 2             hash functions
//   h_i(x) = h1(x) + i * h2(x)  mod m   (Kirsch–Mitzenmacher double hashing)
// No false negatives: an added key always tests positive. A positive is only a
// "maybe" and must be confirmed against the source of truth (PostgreSQL).
export class BloomFilter {
  readonly m: number;
  readonly k: number;
  private readonly bits: Uint8Array;
  private count = 0;

  constructor(
    readonly n: number,
    readonly p: number,
  ) {
    if (!(n > 0)) throw new RangeError("n must be positive");
    if (!(p > 0 && p < 1)) throw new RangeError("p must be in (0, 1)");
    this.m = Math.max(8, Math.ceil((-n * Math.log(p)) / Math.LN2 ** 2));
    this.k = Math.max(1, Math.round((this.m / n) * Math.LN2));
    this.bits = new Uint8Array(Math.ceil(this.m / 8));
  }

  private positions(key: string, visit: (bit: number) => boolean | void): boolean {
    const h1 = murmur3(key, 0x9747b28c);
    // h2 must be non-zero mod m, or every probe would land on the same bit.
    let h2 = murmur3(key, 0x5bd1e995) % this.m;
    if (h2 === 0) h2 = 1;
    let pos = h1 % this.m;
    for (let i = 0; i < this.k; i++) {
      if (visit(pos) === false) return false;
      pos += h2;
      if (pos >= this.m) pos -= this.m;
    }
    return true;
  }

  add(key: string): void {
    this.positions(key, (b) => {
      this.bits[b >>> 3]! |= 1 << (b & 7);
    });
    this.count++;
  }

  mightContain(key: string): boolean {
    return this.positions(key, (b) => (this.bits[b >>> 3]! & (1 << (b & 7))) !== 0);
  }

  /** Items added so far. */
  get size(): number {
    return this.count;
  }

  /** Theoretical false-positive rate at the current fill: (1 - e^(-k n / m))^k. */
  expectedFpr(): number {
    return (1 - Math.exp((-this.k * this.count) / this.m)) ** this.k;
  }

  /** Bytes used by the bit array. */
  get byteLength(): number {
    return this.bits.byteLength;
  }
}
