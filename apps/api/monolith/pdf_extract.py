"""Text-only PDF parser process invoked by ingestion.py with an empty environment."""

import hashlib
import io
import json
import resource
import sys


def main():
    resource.setrlimit(resource.RLIMIT_AS, (384 << 20, 384 << 20))
    resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(sys.stdin.buffer.read(6 * 1024 * 1024 + 1)))
    if reader.is_encrypted:
        print(json.dumps({"error": "Supply a text PDF without password protection."}))
        return
    if len(reader.pages) > 100:
        print(json.dumps({"error": "Maximum PDF length is 100 pages"}))
        return
    # Stream the same digest(filename, pages) encoding as the portable core.
    # Only the retained excerpt for each page is kept in memory between pages.
    hasher = hashlib.sha256()
    hasher.update(("[" + json.dumps(sys.argv[1], ensure_ascii=False) + ", [").encode())
    pages = []
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if index:
            hasher.update(b", ")
        hasher.update(json.dumps(text, ensure_ascii=False).encode())
        pages.append(text[:20_000])
    hasher.update(b"]]")
    print(
        json.dumps(
            {"pages": pages, "source_id": "SRC-" + hasher.hexdigest()[:16]},
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
