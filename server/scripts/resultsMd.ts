import { existsSync, readFileSync, writeFileSync } from "node:fs";

const RESULTS = new URL("../../docs/results.md", import.meta.url).pathname;
export const README = new URL("../../README.md", import.meta.url).pathname;

/** Replace (or append) the section between <!-- name:start --> and <!-- name:end --> in docs/results.md. */
export function upsertResultsSection(name: string, body: string, path = RESULTS): void {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  let doc = existsSync(path) ? readFileSync(path, "utf8") : "# Results\n";
  const block = `${start}\n${body.trim()}\n${end}`;
  const i = doc.indexOf(start);
  const j = doc.indexOf(end);
  doc = i >= 0 && j > i ? doc.slice(0, i) + block + doc.slice(j + end.length) : `${doc.trimEnd()}\n\n${block}\n`;
  writeFileSync(path, doc);
}
