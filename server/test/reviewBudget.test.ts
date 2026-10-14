import { describe, expect, it } from "vitest";
import { ReviewBudget } from "../src/decision/reviewBudget.js";

const DAY = 86_400;

describe("ReviewBudget", () => {
  it("caps reviews at share x previous day's volume and prefers high scores", () => {
    const b = new ReviewBudget(0.1);
    // Day 0: 100 transactions, 30 candidates with scores 0.01..0.30 (first day: first come, first served).
    for (let i = 0; i < 100; i++) {
      b.observe(i);
      if (i < 30) b.admit((i + 1) / 100);
    }
    // Day 1: budget is 10 (10% of 100); bar is the 10th best score from day 0 (0.21).
    const admitted: number[] = [];
    for (let i = 0; i < 100; i++) {
      b.observe(DAY + i);
      const score = ((i * 37) % 100) / 100;
      if (b.admit(score)) admitted.push(score);
    }
    expect(admitted.length).toBeLessThanOrEqual(10);
    expect(Math.min(...admitted)).toBeGreaterThanOrEqual(0.21);
  });

  it("never admits more than the budget even if every case clears the bar", () => {
    const b = new ReviewBudget(0.02);
    for (let i = 0; i < 1000; i++) b.observe(i);
    let n = 0;
    for (let i = 0; i < 1000; i++) {
      b.observe(DAY + i);
      if (b.admit(0.99)) n++;
    }
    expect(n).toBe(20);
    expect(b.skipped).toBe(980);
  });
});
