import argparse
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Dict, Any, Tuple

# Third-party imports
import bibtexparser
from google import genai
from google.genai import types
import psycopg
from psycopg.types.json import Json
from pypdf import PdfReader
from dotenv import load_dotenv

# Must match the model and dimension used in app/api/chat/route.ts and db/init.sh.
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768
# The free tier counts every text in a batch as one request, against a limit of
# 100 per minute (plus a tokens-per-minute cap), so batching saves round trips
# but not quota. Dense PDFs also hit the tokens-per-minute cap at 90 texts a
# minute, and retries count against the daily quota, so send 25 at a time,
# 30 a minute.
EMBEDDING_BATCH_SIZE = 25
EMBEDDINGS_PER_MINUTE = 30

genai_client: genai.Client | None = None
last_batch_at = 0.0


class DailyQuotaExhausted(Exception):
    pass


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Ingest PDF documents with BibTeX metadata into Postgres (pgvector)."
    )

    script_dir = Path(__file__).resolve().parent
    default_env = script_dir.parent / ".env"
    default_docs = script_dir.parent / "docs"

    parser.add_argument(
        "--docs-dir",
        type=Path,
        default=default_docs,
        help="Directory containing PDF and .bib files.",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=default_env,
        help="Path to the .env file.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip files already fully stored; re-ingest incomplete ones.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Do not ask for confirmation.",
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Truncate (empty) the documents table before ingesting.",
    )

    return parser.parse_args()


def setup_services(env_path: Path):
    if not env_path.exists():
        raise FileNotFoundError(f"Environment file not found at: {env_path}")

    load_dotenv(env_path)

    # The ingest role (write access), not the app's read-only role.
    database_url = os.getenv("INGEST_DATABASE_URL")
    google_key = os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")

    if not all([database_url, google_key]):
        raise ValueError(
            "INGEST_DATABASE_URL and GOOGLE_GENERATIVE_AI_API_KEY must be set in the .env file."
        )

    global genai_client
    conn = psycopg.connect(database_url, autocommit=True)
    genai_client = genai.Client(api_key=google_key)

    return conn, genai_client


def parse_bib_file(bib_path: Path, filename: str) -> Dict[str, Any]:
    """Parses a single .bib file and returns all metadata fields."""
    metadata = {
        "source": filename,
        "title": filename,
        "year": "Unknown",
        "type": "document",
        "author": "Unknown",
    }

    try:
        bib_text = bib_path.read_text(encoding="utf-8")
        bib_database = bibtexparser.loads(bib_text)

        if bib_database.entries:
            entry = bib_database.entries[0]
            # Store all BibTeX fields in metadata
            for key, value in entry.items():
                if key == "ID":
                    metadata["bibtex_id"] = value
                elif key == "ENTRYTYPE":
                    metadata["type"] = value
                elif key == "title":
                    metadata["title"] = value.replace("{", "").replace("}", "")
                else:
                    metadata[key] = value
    except Exception as e:
        print(f"  [Error] Failed to parse {bib_path.name}: {e}")

    return metadata


def scan_documents(docs_dir: Path) -> Tuple[List[dict], List[str]]:
    if not docs_dir.exists():
        raise FileNotFoundError(f"Docs directory not found: {docs_dir}")

    pdf_files = sorted(docs_dir.glob("*.pdf")) + sorted(docs_dir.glob("*.txt"))
    valid_items = []
    missing_bibs = []

    for pdf_path in pdf_files:
        bib_path = pdf_path.with_suffix(".bib")

        if not bib_path.exists():
            missing_bibs.append(pdf_path.name)
            default_meta = {
                "source": pdf_path.name,
                "title": pdf_path.stem,
                "year": "Unknown",
                "type": "document",
            }
            valid_items.append({"path": pdf_path, "meta": default_meta})
        else:
            meta = parse_bib_file(bib_path, pdf_path.name)
            valid_items.append({"path": pdf_path, "meta": meta})

    return valid_items, missing_bibs


def truncate_database(conn: psycopg.Connection):
    print("\n[Action] Truncating 'documents' table...")
    try:
        conn.execute("truncate documents restart identity")
        print("  ✓ Table cleared.")
    except Exception as e:
        print(f"  [Error] Failed to truncate table: {e}")


def sanitize_text(text: str) -> str:
    """Remove null bytes and other problematic characters for PostgreSQL."""
    return text.replace("\x00", "")


def retry_delay(error: Exception) -> float | None:
    """Seconds the API asks us to wait on a 429, if it says."""
    match = re.search(r"retry in ([0-9.]+)s", str(error))
    return float(match.group(1)) if match else None


def quota_ids(error: Exception) -> str:
    """The quota names in a 429, e.g. EmbedContentRequestsPerMinute...-FreeTier."""
    return ", ".join(re.findall(r"quotaId': '([^']+)'", str(error))) or str(error)[:200]


def pace(batch_len: int):
    """Sleep so that batches stay under EMBEDDINGS_PER_MINUTE."""
    global last_batch_at
    min_gap = 60 * batch_len / EMBEDDINGS_PER_MINUTE
    wait = last_batch_at + min_gap - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    last_batch_at = time.monotonic()


def get_embeddings(texts: List[str], max_retries: int = 5) -> List[List[float]]:
    for attempt in range(max_retries):
        pace(len(texts))
        try:
            assert genai_client is not None, "call setup_services() first"
            result = genai_client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=texts,
                config=types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=EMBEDDING_DIMENSIONS,
                ),
            )
            return [list(e.values) for e in result.embeddings]
        except Exception as e:
            if "PerDay" in str(e):
                raise DailyQuotaExhausted(quota_ids(e)) from e
            if attempt < max_retries - 1:
                wait = (retry_delay(e) or 2 ** (attempt + 1)) + 2
                print(f"  [Retry] Embedding failed, retrying in {wait:.0f}s... ({quota_ids(e)})")
                time.sleep(wait)
            else:
                raise


def chunk_text(
    text: str, chunk_size: int = 1000, overlap: int = 100
) -> List[str]:
    chunks = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks


def stored_chunk_indexes(conn: psycopg.Connection, source: str) -> List[int]:
    rows = conn.execute(
        "select (metadata->>'chunk_index')::int from documents"
        " where metadata->>'source' = %s",
        (source,),
    ).fetchall()
    return [row[0] for row in rows]


ASSUME_YES = False


def confirm_action(prompt: str) -> bool:
    if ASSUME_YES:
        return True
    response = input(f"{prompt} (y/n): ").strip().lower()
    return response == "y"


def main():
    args = parse_arguments()
    global ASSUME_YES
    ASSUME_YES = args.yes

    # 1. Scan Files
    print(f"Scanning directory: {args.docs_dir} ...")
    items, missing_bibs = scan_documents(args.docs_dir)

    if not items:
        print("No PDF files found.")
        return

    # 2. Check Missing Bibs FIRST
    if missing_bibs:
        print("\n" + "!" * 60)
        print(f"WARNING: {len(missing_bibs)} file(s) missing .bib metadata:")
        for name in missing_bibs:
            print(f"  - {name}")
        print("!" * 60)

        if not confirm_action(
            "Continue without metadata for these files?"
        ):
            print("Aborted.")
            sys.exit(0)

    # 3. Review Metadata
    total = len(items)
    print("\n" + "=" * 60)
    print(f"{'FILENAME':<35} | {'YEAR':<6} | {'TITLE'}")
    print("-" * 60)
    for item in items:
        m = item["meta"]
        display_title = (
            (m["title"][:40] + "..") if len(m["title"]) > 40 else m["title"]
        )
        print(f"{m['source']:<35} | {m['year']:<6} | {display_title}")
    print("=" * 60)
    print(f"Total files to ingest: {total}")

    if not confirm_action("\nStart ingestion process?"):
        print("Aborted.")
        sys.exit(0)

    # 4. Connect to Services
    try:
        conn, _ = setup_services(args.env_file)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # 5. Truncate if requested
    if args.truncate:
        truncate_database(conn)

    # 6. Ingestion Loop
    print("\nStarting Ingestion...")
    total_errors = 0

    for file_idx, item in enumerate(items, 1):
        file_path = item["path"]
        metadata = item["meta"]
        pct = file_idx * 100 // total

        print(f"\nProcessing {file_idx}/{total} [{pct}%]: {file_path.name}")

        try:
            if file_path.suffix == ".txt":
                full_text = file_path.read_text(encoding="utf-8")
            else:
                reader = PdfReader(str(file_path))
                full_text = ""
                for page in reader.pages:
                    text = page.extract_text()
                    if text:
                        full_text += text + "\n"

            full_text = sanitize_text(full_text)
            chunks = chunk_text(full_text)
            file_errors = 0

            todo = list(range(len(chunks)))
            if args.resume:
                stored = stored_chunk_indexes(conn, metadata["source"])
                if len(stored) != len(set(stored)) or any(
                    i >= len(chunks) for i in stored
                ):
                    # Duplicates or a different chunking: start this file over.
                    conn.execute(
                        "delete from documents where metadata->>'source' = %s",
                        (metadata["source"],),
                    )
                    print(f"  Removed {len(stored)} inconsistent chunks")
                    stored = []
                todo = [i for i in todo if i not in set(stored)]
                if not todo:
                    print(f"  Skipped: all {len(chunks)} chunks already stored")
                    continue
                if stored:
                    print(f"  Resuming: {len(todo)} of {len(chunks)} chunks missing")

            for pos in range(0, len(todo), EMBEDDING_BATCH_SIZE):
                indexes = todo[pos : pos + EMBEDDING_BATCH_SIZE]
                batch = [chunks[i] for i in indexes]
                start = indexes[0]
                try:
                    embeddings = get_embeddings(batch)
                    with conn.cursor() as cur:
                        cur.executemany(
                            "insert into documents (content, metadata, embedding)"
                            " values (%s, %s, %s::vector)",
                            [
                                (
                                    chunk,
                                    Json({**metadata, "chunk_index": i}),
                                    str(embedding),
                                )
                                for i, chunk, embedding in zip(
                                    indexes, batch, embeddings, strict=True
                                )
                            ],
                        )
                    print(
                        f"  Chunk {indexes[-1] + 1}/{len(chunks)}",
                        end="\r",
                    )

                except DailyQuotaExhausted:
                    raise
                except Exception as e:
                    file_errors += len(batch)
                    total_errors += len(batch)
                    print(
                        f"  [Error] Chunks {start}-{indexes[-1]} failed: {quota_ids(e)}"
                    )

            status = f" ({file_errors} errors)" if file_errors else ""
            print(
                f"  Done: {len(chunks)} chunks{status}"
                + " " * 20
            )

        except DailyQuotaExhausted as e:
            print(f"\n[Stopped] Daily embedding quota exhausted: {e}")
            print("Run again with --resume after the quota resets.")
            sys.exit(2)
        except Exception as e:
            total_errors += 1
            print(f"  [Error] Failed to read file: {e}")

    print(f"\n✅ Ingestion Complete! ({total} files, {total_errors} errors)")
    if total_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
