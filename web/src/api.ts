export interface ReviewCase {
  transaction_id: number;
  score: number;
  reasons: string[];
  card_entity: string;
  device_entity: string | null;
  amount: number;
  transaction_dt: number;
  created_at: string;
}

export interface RingNode {
  id: string;
  type: "card" | "device";
  key: string;
  depth: number;
  fraud: boolean;
  supernode: boolean;
}

export interface RingResponse {
  entity: string;
  ring: { ring_id: string; ring_size: number; ring_fraud_entities: number; ring_fraud_others: number };
  nodes: RingNode[];
  edges: [string, string][];
  truncated: boolean;
  hops: number;
  limit: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  reviews: (limit = 100) => fetch(`/v1/reviews?limit=${limit}`).then((r) => json<{ open: number; cases: ReviewCase[] }>(r)),
  label: (id: number, label: "fraud" | "legit") =>
    fetch(`/v1/reviews/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    }).then((r) => json<{ open: number }>(r)),
  ring: (type: string, key: string, hops: number, limit: number) =>
    fetch(`/v1/rings/${type}/${encodeURIComponent(key)}?hops=${hops}&limit=${limit}`).then((r) => json<RingResponse>(r)),
};

export const money = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const day = (dt: number) => `day ${(dt / 86_400).toFixed(2)}`;
