import { useCallback, useEffect, useState } from "react";
import { api, day, money, type ReviewCase } from "./api";

const ringHref = (type: "card" | "device", key: string) => `#/ring/${type}/${encodeURIComponent(key)}`;

export default function ReviewQueue() {
  const [cases, setCases] = useState<ReviewCase[]>([]);
  const [open, setOpen] = useState(0);
  const [selected, setSelected] = useState<ReviewCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.reviews(100);
      setCases(r.cases);
      setOpen(r.open);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const label = async (c: ReviewCase, l: "fraud" | "legit") => {
    setBusy(true);
    try {
      await api.label(c.transaction_id, l);
      setSelected(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-medium">
            Open cases <span className="text-slate-500">({open.toLocaleString()})</span>
          </h2>
          <button onClick={() => void load()} className="text-sm text-blue-700 hover:underline">
            Refresh
          </button>
        </div>
        {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Risk</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Top reason</th>
                <th className="px-3 py-2">Event time</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr
                  key={c.transaction_id}
                  onClick={() => setSelected(c)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${selected?.transaction_id === c.transaction_id ? "bg-blue-50" : ""}`}
                >
                  <td className="px-3 py-2 font-mono">{c.score.toFixed(3)}</td>
                  <td className="px-3 py-2">{money(c.amount)}</td>
                  <td className="max-w-md truncate px-3 py-2 text-slate-700">{c.reasons[0] ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-500">{day(c.transaction_dt)}</td>
                </tr>
              ))}
              {cases.length === 0 && !error && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    No open cases. Replay some transactions first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="h-fit rounded-lg border border-slate-200 bg-white p-4 lg:sticky lg:top-4">
        {selected ? (
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs uppercase text-slate-500">Transaction</div>
              <div className="font-mono">{selected.transaction_id}</div>
              <div className="mt-1">
                {money(selected.amount)} · risk {selected.score.toFixed(3)} · {day(selected.transaction_dt)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-slate-500">Reasons</div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {selected.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase text-slate-500">Entities</div>
              <a className="block break-all text-blue-700 hover:underline" href={ringHref("card", selected.card_entity)}>
                Open ring for card {selected.card_entity}
              </a>
              {selected.device_entity && (
                <a className="block break-all text-blue-700 hover:underline" href={ringHref("device", selected.device_entity)}>
                  Open ring for device {selected.device_entity}
                </a>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                disabled={busy}
                onClick={() => void label(selected, "fraud")}
                className="flex-1 rounded bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Fraud
              </button>
              <button
                disabled={busy}
                onClick={() => void label(selected, "legit")}
                className="flex-1 rounded bg-emerald-600 px-3 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Legitimate
              </button>
            </div>
            <p className="text-xs text-slate-500">Fraud blocklists the card and device from now on and marks them in the ring graph.</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Select a case to see its reasons, label it, or open its ring.</p>
        )}
      </aside>
    </div>
  );
}
