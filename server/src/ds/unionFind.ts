// Disjoint-set union over string ids with path compression and union by rank.
// Amortized near-constant time per operation (inverse Ackermann).
// Ids are interned to integers so the hot arrays stay compact.
// Union-find cannot delete an edge: to drop a link, rebuild from the edge list.
export class UnionFind {
  private readonly index = new Map<string, number>();
  private readonly names: string[] = [];
  private parent = new Int32Array(1024);
  private rank = new Uint8Array(1024);
  private sizes = new Int32Array(1024);

  /** Number of distinct ids seen. */
  get count(): number {
    return this.names.length;
  }

  has(x: string): boolean {
    return this.index.has(x);
  }

  private id(x: string): number {
    let i = this.index.get(x);
    if (i === undefined) {
      i = this.names.length;
      if (i === this.parent.length) this.grow();
      this.index.set(x, i);
      this.names.push(x);
      this.parent[i] = i;
      this.sizes[i] = 1;
    }
    return i;
  }

  private grow(): void {
    const cap = this.parent.length * 2;
    const p = new Int32Array(cap);
    p.set(this.parent);
    const r = new Uint8Array(cap);
    r.set(this.rank);
    const s = new Int32Array(cap);
    s.set(this.sizes);
    this.parent = p;
    this.rank = r;
    this.sizes = s;
  }

  private root(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    // Path compression: point every node on the path straight at the root.
    while (this.parent[i] !== r) {
      const next = this.parent[i]!;
      this.parent[i] = r;
      i = next;
    }
    return r;
  }

  find(x: string): string {
    return this.names[this.root(this.id(x))]!;
  }

  /** Merges the sets of a and b. Returns the new root id, or null if already joined. */
  union(a: string, b: string): string | null {
    let ra = this.root(this.id(a));
    let rb = this.root(this.id(b));
    if (ra === rb) return null;
    if (this.rank[ra]! < this.rank[rb]!) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.sizes[ra]! += this.sizes[rb]!;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]!++;
    return this.names[ra]!;
  }

  size(x: string): number {
    return this.sizes[this.root(this.id(x))]!;
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}
