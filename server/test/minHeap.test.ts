import { describe, expect, it } from "vitest";
import { MinHeap } from "../src/ds/minHeap.js";

describe("MinHeap", () => {
  it("pops in priority order and breaks ties by insertion (age)", () => {
    const h = new MinHeap<string>();
    h.push("c", 3);
    h.push("a-old", 1);
    h.push("b", 2);
    h.push("a-new", 1);
    expect(h.peek()).toBe("a-old");
    expect([h.pop(), h.pop(), h.pop(), h.pop(), h.pop()]).toEqual(["a-old", "a-new", "b", "c", undefined]);
  });

  it("sorts random input like Array.sort", () => {
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const h = new MinHeap<number>();
    const xs = Array.from({ length: 5000 }, () => Math.floor(rand() * 1000));
    xs.forEach((x, i) => h.push(i, x));
    const order: number[] = [];
    for (let v = h.pop(); v !== undefined; v = h.pop()) order.push(v);
    const expected = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0] || p[1] - q[1]).map(([, i]) => i);
    expect(order).toEqual(expected);
  });

  it("peekMany returns the k smallest without removing them", () => {
    const h = new MinHeap<number>();
    [5, 1, 4, 2, 3, 0].forEach((p) => h.push(p, p));
    expect(h.peekMany(3)).toEqual([0, 1, 2]);
    expect(h.size).toBe(6);
    expect(h.peekMany(10)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("removeWhere keeps the heap valid", () => {
    const h = new MinHeap<number>();
    for (let i = 0; i < 100; i++) h.push(i, 100 - i);
    expect(h.removeWhere((x) => x % 2 === 0)).toBe(50);
    const out: number[] = [];
    for (let v = h.pop(); v !== undefined; v = h.pop()) out.push(v);
    expect(out).toEqual(Array.from({ length: 50 }, (_, k) => 99 - 2 * k));
  });
});
