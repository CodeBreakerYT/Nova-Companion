import datetime
import os
import sqlite3
from pathlib import Path

import config
from memory.store import get_allowed_dirs

DB_PATH = config.DATA_DIR / "index.sqlite3"

TEXT_EXTS = {".txt", ".md"}
PDF_EXTS = {".pdf"}
DOCX_EXTS = {".docx"}

# Directories we never descend into even if they happen to sit inside an
# allowlisted root — build artifacts, VCS internals, and dependency trees
# are noise (and can be huge) for a "find my document" search.
SKIP_DIR_NAMES = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
    "$RECYCLE.BIN", "System Volume Information", ".cache",
}

MAX_FILES = 20000
MAX_TEXT_CHARS = 20000  # per file, keeps both indexing and DB size bounded


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            filename, content,
            path UNINDEXED, ext UNINDEXED, size UNINDEXED,
            modified UNINDEXED, created UNINDEXED
        )
        """
    )
    return conn


def extract_text(path: Path, max_chars: int = MAX_TEXT_CHARS) -> str:
    """Shared by the search indexer and the read_document tool — the only
    place that knows how to pull real text out of a .txt/.md/.pdf/.docx
    file, so NOVA can actually use a resume's or report's content instead
    of just knowing the file exists."""
    ext = path.suffix.lower()
    try:
        if ext in TEXT_EXTS:
            return path.read_text(encoding="utf-8", errors="ignore")[:max_chars]
        if ext in PDF_EXTS:
            from pypdf import PdfReader

            reader = PdfReader(str(path))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            return text[:max_chars]
        if ext in DOCX_EXTS:
            import docx

            doc = docx.Document(str(path))
            text = "\n".join(p.text for p in doc.paragraphs)
            return text[:max_chars]
    except Exception:
        return ""
    return ""


def rescan() -> int:
    """Walks every allowlisted directory and rebuilds the index from
    scratch. Simple full-rebuild rather than incremental — fast enough for
    a demo-sized set of allowlisted folders and avoids stale-entry bugs."""
    conn = _connect()
    conn.execute("DELETE FROM files_fts")

    count = 0
    for root_dir in get_allowed_dirs():
        root = Path(root_dir)
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES and not d.startswith(".")]
            for name in filenames:
                if count >= MAX_FILES:
                    conn.commit()
                    conn.close()
                    return count
                path = Path(dirpath) / name
                try:
                    stat = path.stat()
                except OSError:
                    continue

                ext = path.suffix.lower()
                content = extract_text(path) if ext in (TEXT_EXTS | PDF_EXTS | DOCX_EXTS) else ""

                conn.execute(
                    "INSERT INTO files_fts (filename, content, path, ext, size, modified, created) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        name,
                        content,
                        str(path),
                        ext,
                        stat.st_size,
                        datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        datetime.datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    ),
                )
                count += 1
    conn.commit()
    conn.close()
    return count


AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}


def search_audio(query: str, limit: int = 5) -> list[dict]:
    """Same ranked filename/content match as search(), restricted to audio
    files — used by the play_music tool."""
    results = search(query, limit=limit * 3)
    return [r for r in results if r["ext"] in AUDIO_EXTS][:limit]


def search(query: str, limit: int = 8) -> list[dict]:
    conn = _connect()
    # Loose prefix-OR match on each token — "dbms project" should surface a
    # file matching either word, ranked by FTS5's bm25 relevance.
    tokens = [t for t in query.replace('"', " ").split() if t]
    if not tokens:
        conn.close()
        return []
    match_expr = " OR ".join(f'{t}*' for t in tokens)

    try:
        rows = conn.execute(
            "SELECT filename, path, ext, size, modified, created, "
            "snippet(files_fts, 1, '', '', '...', 12) "
            "FROM files_fts WHERE files_fts MATCH ? ORDER BY rank LIMIT ?",
            (match_expr, limit),
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    conn.close()

    return [
        {
            "filename": r[0],
            "path": r[1],
            "ext": r[2],
            "size": r[3],
            "modified": r[4],
            "created": r[5],
            "snippet": r[6],
        }
        for r in rows
    ]


def index_count() -> int:
    conn = _connect()
    (count,) = conn.execute("SELECT count(*) FROM files_fts").fetchone()
    conn.close()
    return count
