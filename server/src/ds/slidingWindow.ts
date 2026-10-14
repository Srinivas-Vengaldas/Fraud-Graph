// Exact sliding-window counter over event time.
//
// Events are kept in time order in a growable ring buffer (parallel arrays of
// times and amounts). A window query (now - windowSec, now] binary-searches the
// first event inside the window, so count is O(log n) and sum is O(events in
// window). Events older than maxWindowSec behind the newest event are dropped
// on insert, so memory per entity is bounded by the activity in the largest window.
//
// Boundary rule: an event at exactly now - windowSec is OUT of the window;
// an event at exactly now is IN.
export class SlidingWindow {
  private times: Float64Array;
  private amounts: Float64Array;
  private head = 0; // index of oldest event
  private len = 0;

  constructor(
    readonly maxWindowSec: number,
    initialCapacity = 4,
  ) {
    this.times = new Float64Array(initialCapacity);
    this.amounts = new Float64Array(initialCapacity);
  }

  get size(): number {
    return this.len;
  }

  /** Newest event time seen, or -Infinity when empty. */
  get latest(): number {
    return this.len === 0 ? -Infinity : this.at(this.len - 1);
  }

  private at(i: number): number {
    return this.times[(this.head + i) % this.times.length]!;
  }

  private amountAt(i: number): number {
    return this.amounts[(this.head + i) % this.amounts.length]!;
  }

  private grow(): void {
    const cap = this.times.length * 2;
    const t = new Float64Array(cap);
    const a = new Float64Array(cap);
    for (let i = 0; i < this.len; i++) {
      t[i] = this.at(i);
      a[i] = this.amountAt(i);
    }
    this.times = t;
    this.amounts = a;
    this.head = 0;
  }

  /** First index whose time is > t. */
  private upperBound(t: number): number {
    let lo = 0;
    let hi = this.len;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.at(mid) <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  add(t: number, amount: number): void {
    // Expire events that can never fall inside any window again.
    const horizon = Math.max(t, this.latest) - this.maxWindowSec;
    while (this.len > 0 && this.at(0) <= horizon) {
      this.head = (this.head + 1) % this.times.length;
      this.len--;
    }
    if (t <= horizon) return; // arrived too late to matter
    if (this.len === this.times.length) this.grow();

    // Usually appends; a slightly out-of-order event is shifted into place.
    let i = this.len;
    const cap = this.times.length;
    while (i > 0 && this.at(i - 1) > t) {
      const from = (this.head + i - 1) % cap;
      const to = (this.head + i) % cap;
      this.times[to] = this.times[from]!;
      this.amounts[to] = this.amounts[from]!;
      i--;
    }
    const slot = (this.head + i) % cap;
    this.times[slot] = t;
    this.amounts[slot] = amount;
    this.len++;
  }

  count(now: number, windowSec: number): number {
    this.assertWindow(windowSec);
    return this.upperBound(now) - this.upperBound(now - windowSec);
  }

  sum(now: number, windowSec: number): number {
    this.assertWindow(windowSec);
    const end = this.upperBound(now);
    let s = 0;
    for (let i = this.upperBound(now - windowSec); i < end; i++) s += this.amountAt(i);
    return s;
  }

  private assertWindow(windowSec: number): void {
    if (windowSec > this.maxWindowSec) {
      throw new RangeError(`window ${windowSec}s exceeds retained ${this.maxWindowSec}s`);
    }
  }
}
