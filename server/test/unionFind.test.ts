import { describe, expect, it } from "vitest";
import { UnionFind } from "../src/ds/unionFind.js";

describe("UnionFind", () => {
  it("joins sets and tracks sizes", () => {
    const uf = new UnionFind();
    expect(uf.size("a")).toBe(1);
    uf.union("a", "b");
    uf.union("c", "d");
    expect(uf.connected("a", "b")).toBe(true);
    expect(uf.connected("a", "c")).toBe(false);
    uf.union("b", "d");
    expect(uf.size("c")).toBe(4);
    expect(uf.union("a", "c")).toBeNull(); // already joined
    expect(new Set(["a", "b", "c", "d"].map((x) => uf.find(x))).size).toBe(1);
  });

  it("agrees with a naive labeling on random unions, across array growth", () => {
    let seed = 3;
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    const uf = new UnionFind();
    const label = new Map<string, number>();
    const N = 5000;
    for (let i = 0; i < N; i++) label.set(`n${i}`, i);
    for (let k = 0; k < 3000; k++) {
      const a = `n${rand(N)}`;
      const b = `n${rand(N)}`;
      uf.union(a, b);
      const la = label.get(a)!;
      const lb = label.get(b)!;
      if (la !== lb) for (const [x, l] of label) if (l === lb) label.set(x, la);
    }
    const counts = new Map<number, number>();
    for (const l of label.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
    for (let i = 0; i < N; i += 37) {
      const x = `n${i}`;
      expect(uf.size(x)).toBe(counts.get(label.get(x)!));
      const y = `n${(i * 7919) % N}`;
      expect(uf.connected(x, y)).toBe(label.get(x) === label.get(y));
    }
  });

  it("keeps trees shallow (path compression + union by rank)", () => {
    const uf = new UnionFind();
    for (let i = 1; i < 100_000; i++) uf.union(`n${i - 1}`, `n${i}`);
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) uf.find(`n${i}`);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(uf.size("n0")).toBe(100_000);
  });
});
