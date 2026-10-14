import type { Transaction } from "../api/schemas.js";

// Twin of prep/entities.py. Both must produce identical strings for the same row;
// test/entityParity.test.ts checks 1,000 rows written by the Python side.
//   card_entity   = `${card1}|${addr1}|${floor(TransactionDT / 86400 - D1)}`
//   device_entity = `${DeviceInfo}|${id_30}|${id_31}|${id_33}`  (only if DeviceInfo present)

const DAY = 86_400;
const NA = "NA";

type Value = string | number | null | undefined;

function missing(v: Value): v is null | undefined {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
}

export function fmt(v: Value): string {
  if (missing(v)) return NA;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  return v;
}

// Python's repr(float) is the shortest round-tripping form, as is JS String(),
// except for exponent formatting ("1e-05" vs "1e-5") and large magnitudes.
function pyFloatRepr(v: number): string {
  const s = String(v);
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(s);
  if (!m) return s;
  return `${m[1]}e${m[2]}${m[3]!.padStart(2, "0")}`;
}

export function birthDay(transactionDt: Value, d1: Value): string {
  if (missing(transactionDt) || missing(d1)) return NA;
  return String(Math.floor(Number(transactionDt) / DAY - Number(d1)));
}

export function cardEntity(tx: Pick<Transaction, "card1" | "addr1" | "TransactionDT" | "D1">): string {
  return `${fmt(tx.card1)}|${fmt(tx.addr1)}|${birthDay(tx.TransactionDT, tx.D1)}`;
}

export function deviceEntity(tx: Pick<Transaction, "DeviceInfo" | "id_30" | "id_31" | "id_33">): string | null {
  if (missing(tx.DeviceInfo) || tx.DeviceInfo === "") return null;
  return `${fmt(tx.DeviceInfo)}|${fmt(tx.id_30)}|${fmt(tx.id_31)}|${fmt(tx.id_33)}`;
}
