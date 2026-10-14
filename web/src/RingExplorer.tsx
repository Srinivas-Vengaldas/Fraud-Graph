import cytoscape from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { api, type RingResponse } from "./api";

interface Props {
  type: "card" | "device";
  entityKey: string;
}

export default function RingExplorer({ type, entityKey }: Props) {
  const [hops, setHops] = useState(2);
  const [limit, setLimit] = useState(100);
  const [data, setData] = useState<RingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(`${type}:${entityKey}`);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(`${type}:${entityKey}`), [type, entityKey]);

  useEffect(() => {
    if (!entityKey) {
      setData(null);
      return;
    }
    api
      .ring(type, entityKey, hops, limit)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [type, entityKey, hops, limit]);

  useEffect(() => {
    if (!data || !box.current) return;
    const cy = cytoscape({
      container: box.current,
      elements: [
        ...data.nodes.map((n) => ({
          data: { id: n.id, label: n.key.length > 28 ? `${n.key.slice(0, 26)}…` : n.key, type: n.type },
          classes: [n.type, n.fraud ? "fraud" : "", n.id === data.entity ? "root" : ""].join(" "),
        })),
        ...data.edges.map(([a, b]) => ({ data: { id: `${a}->${b}`, source: a, target: b } })),
      ],
      style: [
        { selector: "node", style: { label: "data(label)", "font-size": 9, color: "#334155", "text-valign": "bottom", "text-margin-y": 4 } },
        { selector: "node.card", style: { "background-color": "#3b82f6", shape: "round-rectangle", width: 22, height: 16 } },
        { selector: "node.device", style: { "background-color": "#94a3b8", shape: "ellipse", width: 18, height: 18 } },
        { selector: "node.fraud", style: { "border-width": 3, "border-color": "#dc2626" } },
        { selector: "node.root", style: { width: 30, height: 24, "font-weight": "bold" } },
        { selector: "edge", style: { width: 1.5, "line-color": "#cbd5e1" } },
      ],
      layout: { name: "cose", animate: false, padding: 40 },
      maxZoom: 1.6,
      minZoom: 0.2,
    });
    cy.on("tap", "node", (evt) => {
      const id = evt.target.id() as string;
      const i = id.indexOf(":");
      window.location.hash = `#/ring/${id.slice(0, i)}/${encodeURIComponent(id.slice(i + 1))}`;
    });
    return () => cy.destroy();
  }, [data]);

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const i = draft.indexOf(":");
    const t = draft.slice(0, i);
    if (i < 0 || (t !== "card" && t !== "device")) {
      setError('enter an entity as "card:<key>" or "device:<key>"');
      return;
    }
    window.location.hash = `#/ring/${t}/${encodeURIComponent(draft.slice(i + 1))}`;
  };

  return (
    <div className="space-y-4">
      <form onSubmit={go} className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs uppercase text-slate-500">Entity</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="card:13926|315|-13"
            className="rounded border border-slate-300 px-2 py-1.5 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase text-slate-500">Hops</span>
          <select value={hops} onChange={(e) => setHops(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1.5">
            {[1, 2, 3, 4].map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase text-slate-500">Node limit</span>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1.5">
            {[25, 50, 100, 200, 300].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <button className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700">Explore</button>
      </form>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {data && (
        <p className="text-sm text-slate-700">
          Ring of <b>{data.ring.ring_size}</b> entities, <b>{data.ring.ring_fraud_entities}</b> with prior fraud. Showing{" "}
          {data.nodes.length} nodes within {data.hops} hops
          {data.truncated && <span className="text-amber-700"> (truncated at {data.limit} nodes)</span>}. Click a node to re-center.
        </p>
      )}
      <div className="flex gap-4 text-xs text-slate-600">
        <span><span className="mr-1 inline-block h-2.5 w-3.5 rounded-sm bg-blue-500 align-middle" />card entity</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-full bg-slate-400 align-middle" />device entity</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-full border-2 border-red-600 align-middle" />prior fraud</span>
      </div>
      <div ref={box} className="h-[560px] w-full rounded-lg border border-slate-200 bg-white" />
      {!entityKey && <p className="text-sm text-slate-500">Enter an entity, or open one from a review case.</p>}
    </div>
  );
}
