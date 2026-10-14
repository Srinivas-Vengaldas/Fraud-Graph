// Binary min-heap. Lower priority pops first; equal priorities pop in insertion
// order (older first), which is how the review queue breaks ties by age.
// push and pop are O(log n); peek is O(1); peekMany(k) is O(k log k).
interface Entry<T> {
  item: T;
  priority: number;
  seq: number;
}

export class MinHeap<T> {
  private readonly a: Entry<T>[] = [];
  private seq = 0;

  get size(): number {
    return this.a.length;
  }

  push(item: T, priority: number): void {
    this.a.push({ item, priority, seq: this.seq++ });
    this.up(this.a.length - 1);
  }

  pop(): T | undefined {
    const n = this.a.length;
    if (n === 0) return undefined;
    const top = this.a[0]!;
    const last = this.a.pop()!;
    if (n > 1) {
      this.a[0] = last;
      this.down(0);
    }
    return top.item;
  }

  peek(): T | undefined {
    return this.a[0]?.item;
  }

  /** The k smallest items in pop order, without removing them. */
  peekMany(k: number): T[] {
    const out: T[] = [];
    if (this.a.length === 0 || k <= 0) return out;
    // Frontier heap over indices of this heap: children of a popped node become candidates.
    const frontier = new MinHeap<number>();
    const key = (i: number) => this.a[i]!;
    const pushIdx = (i: number) => {
      if (i < this.a.length) frontier.pushEntry(i, key(i).priority, key(i).seq);
    };
    pushIdx(0);
    while (out.length < k && frontier.size > 0) {
      const i = frontier.pop()!;
      out.push(this.a[i]!.item);
      pushIdx(2 * i + 1);
      pushIdx(2 * i + 2);
    }
    return out;
  }

  /** Removes every item matching pred (O(n)); used to drop labeled review cases. */
  removeWhere(pred: (item: T) => boolean): number {
    const keep = this.a.filter((e) => !pred(e.item));
    const removed = this.a.length - keep.length;
    if (removed > 0) {
      // Copy element by element: spreading a large array into push() overflows the call stack.
      this.a.length = keep.length;
      for (let i = 0; i < keep.length; i++) this.a[i] = keep[i]!;
      for (let i = (this.a.length >> 1) - 1; i >= 0; i--) this.down(i);
    }
    return removed;
  }

  private pushEntry(item: T, priority: number, seq: number): void {
    this.a.push({ item, priority, seq });
    this.up(this.a.length - 1);
  }

  private less(i: number, j: number): boolean {
    const x = this.a[i]!;
    const y = this.a[j]!;
    return x.priority < y.priority || (x.priority === y.priority && x.seq < y.seq);
  }

  private swap(i: number, j: number): void {
    const t = this.a[i]!;
    this.a[i] = this.a[j]!;
    this.a[j] = t;
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    const n = this.a.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }
}
