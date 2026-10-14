import { SlidingWindow } from "../ds/slidingWindow.js";

export const HOUR = 3600;
export const DAY = 86_400;

export interface VelocityFeatures {
  card_tx_1h: number;
  card_tx_24h: number;
  card_amt_1h: number;
  card_amt_24h: number;
  device_tx_1h: number | null;
  device_tx_24h: number | null;
  device_amt_1h: number | null;
  device_amt_24h: number | null;
  device_cards_24h: number | null; // distinct card entities on this device in 24 h
}

// Per-entity velocity on event time (TransactionDT from the request, never the
// server clock), so replaying the same data always yields the same counts.
// Counts include the current transaction.
export class VelocityTracker {
  private readonly cards = new Map<string, SlidingWindow>();
  private readonly devices = new Map<string, SlidingWindow>();
  private readonly deviceCards = new Map<string, Map<string, number>>(); // device -> card -> last seen t
  private observed = 0;
  private latestT = -Infinity;

  constructor(private readonly sweepEvery = 50_000) {}

  observe(t: number, amount: number, card: string, device: string | null): VelocityFeatures {
    this.latestT = Math.max(this.latestT, t);
    const cw = this.window(this.cards, card);
    cw.add(t, amount);

    let dev: Pick<VelocityFeatures, "device_tx_1h" | "device_tx_24h" | "device_amt_1h" | "device_amt_24h" | "device_cards_24h"> = {
      device_tx_1h: null,
      device_tx_24h: null,
      device_amt_1h: null,
      device_amt_24h: null,
      device_cards_24h: null,
    };
    if (device !== null) {
      const dw = this.window(this.devices, device);
      dw.add(t, amount);
      let seen = this.deviceCards.get(device);
      if (!seen) this.deviceCards.set(device, (seen = new Map()));
      seen.set(card, Math.max(seen.get(card) ?? -Infinity, t));
      let distinct = 0;
      for (const [c, last] of seen) {
        if (last > t - DAY) distinct++;
        else if (last <= this.latestT - DAY) seen.delete(c);
      }
      dev = {
        device_tx_1h: dw.count(t, HOUR),
        device_tx_24h: dw.count(t, DAY),
        device_amt_1h: round2(dw.sum(t, HOUR)),
        device_amt_24h: round2(dw.sum(t, DAY)),
        device_cards_24h: distinct,
      };
    }

    if (++this.observed % this.sweepEvery === 0) this.sweep();

    return {
      card_tx_1h: cw.count(t, HOUR),
      card_tx_24h: cw.count(t, DAY),
      card_amt_1h: round2(cw.sum(t, HOUR)),
      card_amt_24h: round2(cw.sum(t, DAY)),
      ...dev,
    };
  }

  /** Number of entities currently held in memory. */
  get entityCount(): { cards: number; devices: number } {
    return { cards: this.cards.size, devices: this.devices.size };
  }

  private window(map: Map<string, SlidingWindow>, key: string): SlidingWindow {
    let w = map.get(key);
    if (!w) map.set(key, (w = new SlidingWindow(DAY)));
    return w;
  }

  // Drop entities idle for more than a day of event time.
  private sweep(): void {
    const cutoff = this.latestT - DAY;
    for (const m of [this.cards, this.devices]) {
      for (const [k, w] of m) if (w.latest <= cutoff) m.delete(k);
    }
    for (const d of this.deviceCards.keys()) if (!this.devices.has(d)) this.deviceCards.delete(d);
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;
