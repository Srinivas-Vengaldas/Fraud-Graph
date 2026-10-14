import { describe, expect, it } from "vitest";
import { BloomFilter } from "../src/ds/bloomFilter.js";

// Deterministic PRNG so the measured rate is reproducible run to run.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("BloomFilter", () => {
  it("sizes m and k from the textbook formulas", () => {
    const bf = new BloomFilter(10_000, 0.01);
    expect(bf.m).toBe(Math.ceil((-10_000 * Math.log(0.01)) / Math.LN2 ** 2)); // 95,851 bits
    expect(bf.k).toBe(7);
  });

  it("has no false negatives", () => {
    const bf = new BloomFilter(20_000, 0.01);
    const keys = Array.from({ length: 20_000 }, (_, i) => `card|${i}|${(i * 7919) % 541}|${i % 300}`);
    keys.forEach((k) => bf.add(k));
    expect(keys.every((k) => bf.mightContain(k))).toBe(true);
  });

  for (const p of [0.01, 0.001]) {
    it(`measured false-positive rate on 100K random keys is within 20% of p=${p}`, () => {
      const n = 50_000;
      const bf = new BloomFilter(n, p);
      for (let i = 0; i < n; i++) bf.add(`member-${i}`);
      const rand = mulberry32(42);
      let fp = 0;
      const trials = 100_000;
      for (let i = 0; i < trials; i++) {
        if (bf.mightContain(`probe-${Math.floor(rand() * 1e12)}-${i}`)) fp++;
      }
      const measured = fp / trials;
      console.log(`p=${p}: measured FPR ${measured.toFixed(5)}, theoretical ${bf.expectedFpr().toFixed(5)}, ${bf.byteLength} bytes`);
      expect(Math.abs(measured - p) / p).toBeLessThan(0.2);
    });
  }

  it("rejects bad parameters", () => {
    expect(() => new BloomFilter(0, 0.01)).toThrow();
    expect(() => new BloomFilter(10, 1)).toThrow();
  });
});
