"""Replace (or append) a marked section of docs/results.md or README.md. Twin of server/scripts/resultsMd.ts."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "docs/results.md"
README = ROOT / "README.md"


def upsert_section(name: str, body: str, path: Path = RESULTS) -> None:
    start, end = f"<!-- {name}:start -->", f"<!-- {name}:end -->"
    doc = path.read_text() if path.exists() else "# Results\n"
    block = f"{start}\n{body.strip()}\n{end}"
    i, j = doc.find(start), doc.find(end)
    doc = doc[:i] + block + doc[j + len(end):] if i >= 0 and j > i else f"{doc.rstrip()}\n\n{block}\n"
    path.write_text(doc)
