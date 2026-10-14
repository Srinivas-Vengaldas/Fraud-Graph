import { useEffect, useState } from "react";
import ReviewQueue from "./ReviewQueue";
import RingExplorer from "./RingExplorer";

// Hash routes: #/ (review queue) and #/ring/<type>/<key>
function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useRoute();
  const ring = /^#\/ring\/(card|device)\/(.*)$/.exec(hash);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">FraudGraph analyst</h1>
        <nav className="flex gap-4 text-sm">
          <a href="#/" className={!ring ? "font-semibold text-blue-700" : "text-slate-600 hover:text-slate-900"}>
            Review queue
          </a>
          <a href="#/ring/card/" className={ring ? "font-semibold text-blue-700" : "text-slate-600 hover:text-slate-900"}>
            Ring explorer
          </a>
        </nav>
      </header>
      {ring ? <RingExplorer type={ring[1] as "card" | "device"} entityKey={decodeURIComponent(ring[2]!)} /> : <ReviewQueue />}
    </div>
  );
}
