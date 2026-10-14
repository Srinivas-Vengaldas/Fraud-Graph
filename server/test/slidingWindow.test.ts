import { describe, expect, it } from "vitest";
import { SlidingWindow } from "../src/ds/slidingWindow.js";

describe("SlidingWindow", () => {
  it("excludes an event exactly windowSec old and includes one at now", () => {
    const w = new SlidingWindow(86_400);
    w.add(1000, 10);
    w.add(4600, 5); // exactly 3600 s later
    expect(w.count(4600, 3600)).toBe(1); // the event at 1000 is on the boundary: out
    expect(w.sum(4600, 3600)).toBe(5);
    expect(w.count(4599, 3600)).toBe(1); // at 4599 the first event is still in, the second not yet
    expect(w.sum(4599, 3600)).toBe(10);
    expect(w.count(4600.5, 3600)).toBe(1);
  });

  it("expires events one second after the boundary", () => {
    const w = new SlidingWindow(86_400);
    w.add(0, 1);
    expect(w.count(3599, 3600)).toBe(1);
    expect(w.count(3600, 3600)).toBe(0);
    expect(w.count(86_399, 86_400)).toBe(1);
    expect(w.count(86_400, 86_400)).toBe(0);
  });

  it("drops events older than the retained window and bounds memory", () => {
    const w = new SlidingWindow(100);
    for (let t = 0; t < 10_000; t += 10) w.add(t, 1);
    expect(w.size).toBeLessThanOrEqual(10);
    expect(w.count(9990, 100)).toBe(10);
  });

  it("places slightly out-of-order events correctly", () => {
    const w = new SlidingWindow(1000);
    [10, 30, 20, 40, 15].forEach((t) => w.add(t, t));
    expect(w.count(40, 1000)).toBe(5);
    expect(w.count(20, 1000)).toBe(3); // 10, 15, 20
    expect(w.sum(40, 25)).toBe(20 + 30 + 40);
  });

  it("matches a brute-force count on random data, across ring-buffer growth and wraparound", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const w = new SlidingWindow(86_400, 2);
    const events: [number, number][] = [];
    let t = 0;
    for (let i = 0; i < 3000; i++) {
      t += Math.floor(rand() * 600);
      const amt = Math.round(rand() * 10000) / 100;
      w.add(t, amt);
      events.push([t, amt]);
      for (const win of [3600, 86_400]) {
        const inWin = events.filter(([et]) => et > t - win && et <= t);
        expect(w.count(t, win)).toBe(inWin.length);
        expect(w.sum(t, win)).toBeCloseTo(inWin.reduce((s, [, a]) => s + a, 0), 6);
      }
    }
  });

  it("refuses windows longer than what it retains", () => {
    expect(() => new SlidingWindow(3600).count(0, 7200)).toThrow(RangeError);
  });
});
