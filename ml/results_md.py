"""Replace (or append) a marked section of docs/results.md. Twin of server/scripts/resultsMd.ts."""

from pathlib import Path

RESULTS = Path(__file__).resolve().parents[1] / "docs/results.md"


def upsert_section(name: str, body: str) -> None:
    start, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    doc = RESULTS.read_text() if RESULTS.exists() else "# Results\n"
    block = f"{start}\n{body.strip()}\n{end}"
    i, j = doc.find(start), doc.find(end)
    doc = doc[:i] + block + doc[j + len(end):] if i >= 0 and j > i else f"{doc.rstrip()}\n\n{block}\n"
    RESULTS.write_text(doc)
