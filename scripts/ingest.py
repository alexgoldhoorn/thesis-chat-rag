import argparse
import os
import sys
import time
from pathlib import Path
from typing import List, Dict, Any, Tuple

# Third-party imports
import bibtexparser
import google.generativeai as genai
from supabase import create_client, Client
from pypdf import PdfReader
from dotenv import load_dotenv


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Ingest PDF documents with BibTeX metadata into Supabase."
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
        "--truncate",
        action="store_true",
        help="Truncate (empty) the documents table before ingesting.",
    )

    return parser.parse_args()


def setup_services(env_path: Path):
    if not env_path.exists():
        raise FileNotFoundError(f"Environment file not found at: {env_path}")

    load_dotenv(env_path)

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    google_key = os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")

    if not all([supabase_url, supabase_key, google_key]):
        raise ValueError("Missing API keys in .env file.")

    supabase = create_client(supabase_url, supabase_key)
    genai.configure(api_key=google_key)

    return supabase, genai


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


def truncate_database(supabase: Client):
    print("\n[Action] Truncating 'documents' table...")
    try:
        supabase.table("documents").delete().neq("id", 0).execute()
        print("  ✓ Table cleared.")
    except Exception as e:
        print(f"  [Error] Failed to truncate table: {e}")


def sanitize_text(text: str) -> str:
    """Remove null bytes and other problematic characters for PostgreSQL."""
    return text.replace("\x00", "")


def get_embedding(text: str, max_retries: int = 3) -> List[float]:
    for attempt in range(max_retries):
        try:
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=text,
                task_type="retrieval_document",
            )
            return result["embedding"]
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"  [Retry] Embedding failed, retrying in {wait}s... ({e})")
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


def confirm_action(prompt: str) -> bool:
    response = input(f"{prompt} (y/n): ").strip().lower()
    return response == "y"


def main():
    args = parse_arguments()

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
        supabase, _ = setup_services(args.env_file)
    except Exception as e:
        print(f"Connection failed: {e}")
        return

    # 5. Truncate if requested
    if args.truncate:
        truncate_database(supabase)

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

            for i, chunk in enumerate(chunks):
                try:
                    embedding = get_embedding(chunk)
                    data = {
                        "content": chunk,
                        "metadata": {**metadata, "chunk_index": i},
                        "embedding": embedding,
                    }
                    supabase.table("documents").insert(data).execute()

                    if i % 5 == 0:
                        print(
                            f"  Chunk {i + 1}/{len(chunks)}",
                            end="\r",
                        )

                except Exception as e:
                    file_errors += 1
                    total_errors += 1
                    print(f"  [Error] Chunk {i} failed: {e}")

            status = f" ({file_errors} errors)" if file_errors else ""
            print(
                f"  Done: {len(chunks)} chunks{status}"
                + " " * 20
            )

        except Exception as e:
            total_errors += 1
            print(f"  [Error] Failed to read file: {e}")

    print(f"\n✅ Ingestion Complete! ({total} files, {total_errors} errors)")


if __name__ == "__main__":
    main()
