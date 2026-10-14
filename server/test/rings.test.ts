import { describe, expect, it } from "vitest";
import { node, RingGraph } from "../src/graph/rings.js";

describe("RingGraph", () => {
  it("joins cards that share a device and counts prior fraud in the ring", () => {
    const g = new RingGraph({ degreeCap: 50 });
    g.markFraud(node("card", "A"));
    g.addTransaction("A", "dev1");
    g.addTransaction("B", "dev1");
    const r = g.addTransaction("C", "dev1");
    expect(r.ring_size).toBe(4); // A, B, C, dev1
    expect(r.ring_fraud_entities).toBe(1);
    expect(r.ring_fraud_others).toBe(1);
    expect(g.ring(node("card", "A")).ring_fraud_others).toBe(0); // A itself is the fraud
  });

  it("cuts a supernode once its degree exceeds the cap and splits the giant ring", () => {
    const seen: string[] = [];
    const g = new RingGraph({ degreeCap: 3, onSupernode: (n) => seen.push(n) });
    g.addTransaction("A", "Windows");
    g.addTransaction("B", "Windows");
    g.addTransaction("C", "Windows");
    expect(g.ring(node("card", "A")).ring_size).toBe(4);
    g.addTransaction("D", "Windows"); // 4th distinct card: over the cap
    expect(seen).toEqual(["device:Windows"]);
    for (const c of ["A", "B", "C", "D"]) expect(g.ring(node("card", c)).ring_size).toBe(1);
    expect(g.addTransaction("E", "Windows").ring_size).toBe(1); // later links are skipped
  });

  it("keeps fraud counts correct across a rebuild", () => {
    const g = new RingGraph({ degreeCap: 2 });
    g.markFraud(node("card", "A"));
    g.addTransaction("A", "rare");
    g.addTransaction("B", "rare");
    g.addTransaction("B", "generic");
    g.addTransaction("C", "generic");
    expect(g.ring(node("card", "C")).ring_fraud_others).toBe(1); // C - generic - B - rare - A
    g.addTransaction("D", "generic"); // generic exceeds cap 2 -> cut
    expect(g.ring(node("card", "C")).ring_fraud_others).toBe(0);
    expect(g.ring(node("card", "B")).ring_fraud_others).toBe(1); // still linked to A via "rare"
  });

  it("without a cap, one generic device merges everyone", () => {
    const g = new RingGraph({ degreeCap: null });
    for (let i = 0; i < 500; i++) g.addTransaction(`card${i}`, "Windows");
    expect(g.ring(node("card", "card0")).ring_size).toBe(501);
  });

  it("BFS respects hop and node limits", () => {
    const g = new RingGraph({ degreeCap: 50 });
    // chain: c0 - d0 - c1 - d1 - c2 - d2 - c3
    for (let i = 0; i < 3; i++) {
      g.addTransaction(`c${i}`, `d${i}`);
      g.addTransaction(`c${i + 1}`, `d${i}`);
    }
    const two = g.bfs(node("card", "c0"), 2, 100);
    expect(two.nodes.map((n) => n.id).sort()).toEqual(["card:c0", "card:c1", "device:d0"]);
    expect(two.edges).toHaveLength(2);
    const capped = g.bfs(node("card", "c0"), 10, 4);
    expect(capped.nodes).toHaveLength(4);
    expect(capped.truncated).toBe(true);
  });
});
