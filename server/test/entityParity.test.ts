import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardEntity, deviceEntity } from "../src/entities/keys.js";

interface Case {
  row: Record<string, string | number | null>;
  card_entity: string;
  device_entity: string | null;
}

// Written by `python prep/entities.py` from the Python implementation.
const cases: Case[] = JSON.parse(readFileSync(new URL("./fixtures/entity_parity.json", import.meta.url), "utf8"));

describe("entity keys match prep/entities.py", () => {
  it("covers 1,000 rows", () => {
    expect(cases).toHaveLength(1000);
  });

  it("produces identical card and device keys", () => {
    const mismatches = cases.filter(
      (c) => cardEntity(c.row as never) !== c.card_entity || deviceEntity(c.row as never) !== c.device_entity,
    );
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  // Same literals are asserted in tests/python/test_entities.py.
  it("handles edge cases the same way", () => {
    expect(cardEntity({ card1: 13926, addr1: 315, TransactionDT: 86400, D1: 14 })).toBe("13926|315|-13");
    expect(cardEntity({ card1: 13926, addr1: null, TransactionDT: 86400, D1: null })).toBe("13926|NA|NA");
    expect(cardEntity({ card1: 2755, addr1: 330, TransactionDT: 1_000_000, D1: 0.5 })).toBe("2755|330|11");
    expect(deviceEntity({ DeviceInfo: null, id_30: "iOS 11", id_31: null, id_33: null })).toBeNull();
    expect(deviceEntity({ DeviceInfo: "Windows", id_30: "Windows 10", id_31: null, id_33: "1920x1080" })).toBe(
      "Windows|Windows 10|NA|1920x1080",
    );
  });
});
