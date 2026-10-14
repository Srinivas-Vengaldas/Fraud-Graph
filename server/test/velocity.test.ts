import { describe, expect, it } from "vitest";
import { DAY, HOUR, VelocityTracker } from "../src/rules/velocity.js";

const events = Array.from({ length: 2000 }, (_, i) => ({
  t: 86_400 + i * 97,
  amt: (i % 17) * 3.5,
  card: `c${i % 40}`,
  device: i % 3 === 0 ? `d${i % 7}` : null,
}));

describe("VelocityTracker", () => {
  it("is deterministic: replaying the same events into a fresh tracker gives identical counts", () => {
    const run = () => {
      const v = new VelocityTracker(500); // sweep often to exercise eviction
      return events.map((e) => v.observe(e.t, e.amt, e.card, e.device));
    };
    expect(run()).toEqual(run());
  });

  it("counts per card and distinct cards per device in 24 h", () => {
    const v = new VelocityTracker();
    v.observe(0, 10, "A", "D");
    v.observe(HOUR - 1, 20, "A", "D");
    v.observe(HOUR, 5, "B", "D");
    const f = v.observe(HOUR + 1, 1, "A", null);
    expect(f.card_tx_1h).toBe(2); // the event at 0 has expired from the 1 h window
    expect(f.card_tx_24h).toBe(3);
    expect(f.card_amt_24h).toBe(31);
    expect(f.device_cards_24h).toBeNull();

    const g = v.observe(DAY - 1, 1, "C", "D");
    expect(g.device_cards_24h).toBe(3); // A, B, C
    const h = v.observe(DAY + HOUR, 1, "C", "D");
    expect(h.device_cards_24h).toBe(1); // A last seen at HOUR-1, B at HOUR: both now exactly 24 h old or more
  });
});
