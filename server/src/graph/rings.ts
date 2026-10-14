import { UnionFind } from "../ds/unionFind.js";

// Identity rings: entities (card and device) joined whenever they appear in the
// same transaction. Union-find keeps the components; this class adds
//   * a supernode cap: a node linked to more than `degreeCap` distinct neighbors
//     (e.g. "Windows|Windows 10|chrome 63.0|1920x1080") is cut out of the graph,
//     because it would otherwise merge thousands of unrelated customers;
//   * per-ring fraud history: how many entities in the ring had prior fraud;
//   * BFS over the stored edges for the ring explorer, with hop and node limits.
// Union-find cannot delete edges, so cutting a supernode rebuilds the components
// from the edge list without it.

export type NodeType = "card" | "device";

export interface RingInfo {
  ring_id: string;
  ring_size: number; // entities in the ring, including this one
  ring_fraud_entities: number; // entities in the ring with prior fraud, including this one
  ring_fraud_others: number; // same, excluding the transaction's own card entity
}

export interface BfsResult {
  nodes: { id: string; type: NodeType; key: string; depth: number; fraud: boolean; supernode: boolean }[];
  edges: [string, string][];
  truncated: boolean;
}

export const node = (type: NodeType, key: string) => `${type}:${key}`;
const typeOf = (n: string) => n.slice(0, n.indexOf(":")) as NodeType;
const keyOf = (n: string) => n.slice(n.indexOf(":") + 1);

export interface RingGraphOptions {
  degreeCap: number | null; // null disables the cap (for the before/after comparison)
  onSupernode?: (node: string, degree: number) => void;
}

export class RingGraph {
  private uf = new UnionFind();
  private readonly adj = new Map<string, Set<string>>();
  private edges: [string, string][] = [];
  private readonly supernodes = new Set<string>();
  private readonly fraud = new Set<string>();
  private fraudByRoot = new Map<string, number>();
  rebuilds = 0;

  constructor(private readonly opts: RingGraphOptions) {}

  get supernodeCount(): number {
    return this.supernodes.size;
  }

  get nodeCount(): number {
    return this.uf.count;
  }

  isSupernode(n: string): boolean {
    return this.supernodes.has(n);
  }

  hasFraud(n: string): boolean {
    return this.fraud.has(n);
  }

  /** Record that an entity had confirmed fraud (training labels, blocklist, analyst label). */
  markFraud(n: string): void {
    if (this.fraud.has(n)) return;
    this.fraud.add(n);
    const r = this.uf.find(n);
    this.fraudByRoot.set(r, (this.fraudByRoot.get(r) ?? 0) + 1);
  }

  /** Adds the transaction's card–device link (if any) and returns the card's ring. */
  addTransaction(card: string, device: string | null): RingInfo {
    const c = node("card", card);
    this.uf.find(c); // make sure the card exists as at least a singleton ring
    if (device !== null) {
      const d = node("device", device);
      if (!this.supernodes.has(d) && !this.supernodes.has(c)) this.link(c, d);
    }
    return this.ring(c);
  }

  ring(n: string): RingInfo {
    const root = this.uf.find(n);
    const total = this.fraudByRoot.get(root) ?? 0;
    return {
      ring_id: root,
      ring_size: this.uf.size(n),
      ring_fraud_entities: total,
      ring_fraud_others: total - (this.fraud.has(n) ? 1 : 0),
    };
  }

  private neighbors(n: string): Set<string> {
    let s = this.adj.get(n);
    if (!s) this.adj.set(n, (s = new Set()));
    return s;
  }

  private link(a: string, b: string): void {
    const na = this.neighbors(a);
    if (na.has(b)) return;
    const nb = this.neighbors(b);
    na.add(b);
    nb.add(a);
    this.edges.push([a, b]);

    const cap = this.opts.degreeCap;
    if (cap !== null) {
      const over = [a, b].filter((x) => this.adj.get(x)!.size > cap);
      if (over.length > 0) {
        for (const x of over) {
          this.supernodes.add(x);
          this.opts.onSupernode?.(x, this.adj.get(x)!.size);
        }
        this.rebuild();
        return;
      }
    }

    const ra = this.uf.find(a);
    const rb = this.uf.find(b);
    const merged = this.uf.union(a, b);
    if (merged !== null) {
      const total = (this.fraudByRoot.get(ra) ?? 0) + (this.fraudByRoot.get(rb) ?? 0);
      this.fraudByRoot.delete(ra);
      this.fraudByRoot.delete(rb);
      if (total > 0) this.fraudByRoot.set(merged, total);
    }
  }

  // Recompute components from scratch without supernode edges.
  private rebuild(): void {
    this.rebuilds++;
    const nodes = [...this.adj.keys()];
    this.edges = this.edges.filter(([a, b]) => !this.supernodes.has(a) && !this.supernodes.has(b));
    for (const s of this.supernodes) {
      // Keep the supernode's own adjacency (degree evidence) but detach it from neighbors.
      for (const nb of this.adj.get(s) ?? []) this.adj.get(nb)?.delete(s);
    }
    // Cards that were never linked are re-created as singletons lazily by find().
    this.uf = new UnionFind();
    for (const n of nodes) this.uf.find(n);
    for (const [a, b] of this.edges) this.uf.union(a, b);
    this.fraudByRoot = new Map();
    for (const f of this.fraud) {
      const r = this.uf.find(f);
      this.fraudByRoot.set(r, (this.fraudByRoot.get(r) ?? 0) + 1);
    }
  }

  /** Breadth-first expansion from an entity, up to maxHops and maxNodes. Supernodes are never expanded. */
  bfs(start: string, maxHops = 2, maxNodes = 100): BfsResult {
    const depth = new Map<string, number>([[start, 0]]);
    const queue = [start];
    const edges: [string, string][] = [];
    let truncated = false;
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi]!;
      const d = depth.get(cur)!;
      if (d >= maxHops || this.supernodes.has(cur)) continue;
      for (const nb of this.adj.get(cur) ?? []) {
        if (!depth.has(nb)) {
          if (depth.size >= maxNodes) {
            truncated = true;
            continue;
          }
          depth.set(nb, d + 1);
          queue.push(nb);
        }
        if (depth.has(nb)) edges.push([cur, nb]);
      }
    }
    return {
      nodes: [...depth].map(([id, dd]) => ({
        id,
        type: typeOf(id),
        key: keyOf(id),
        depth: dd,
        fraud: this.fraud.has(id),
        supernode: this.supernodes.has(id),
      })),
      edges: dedupe(edges),
      truncated,
    };
  }
}

function dedupe(edges: [string, string][]): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const [a, b] of edges) {
    const k = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(a < b ? [a, b] : [b, a]);
    }
  }
  return out;
}
