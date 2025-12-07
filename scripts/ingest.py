import argparse
import os
import sys
from pathlib import Path
from typing import List, Dict, Any, Tuple

# Third-party imports
import bibtexparser
import google.generativeai as genai
from supabase import create_client, Client
from pypdf import PdfReader
from dotenv import load_dotenv

def parse_arguments():
    parser = argparse.ArgumentParser(description="Ingest PDF documents with BibTeX metadata into Supabase.")
    
    script_dir = Path(__file__).resolve().parent
    default_env = script_dir.parent / ".env"
    default_docs = script_dir.parent / "docs"

    parser.add_argument(
        "--docs-dir", 
        type=Path, 
        default=default_docs, 
        help="Directory containing PDF and .bib files."
    )
    parser.add_argument(
        "--env-file", 
        type=Path, 
        default=default_env, 
        help="Path to the .env file."
    )
    parser.add_argument(
        "--truncate", 
        action="store_true", 
        help="Truncate (empty) the documents table before ingesting."
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
    """Parses a single .bib file."""
    metadata = {
        "source": filename,
        "title": filename, 
        "year": "Unknown",
        "type": "document",
        "author": "Unknown"
    }

    try:
        bib_text = bib_path.read_text(encoding='utf-8')
        bib_database = bibtexparser.loads(bib_text)
            
        if bib_database.entries:
            entry = bib_database.entries[0]
            metadata.update({
                "title": entry.get("title", filename).replace("{", "").replace("}", ""),
                "year": entry.get("year", "Unknown"),
                "journal": entry.get("journal", entry.get("booktitle", "Unknown")),
                "type": entry.get("ENTRYTYPE", "document"),
                "author": entry.get("author", "Unknown")
            })
    except Exception as e:
        print(f"  [Error] Failed to parse {bib_path.name}: {e}")
        
    return metadata

def scan_documents(docs_dir: Path) -> Tuple[List[dict], List[str]]:
    """
    Scans directory, matches PDFs with Bibs, and returns:
    1. List of valid ingest items (path, metadata)
    2. List of filenames missing .bib files
    """
    if not docs_dir.exists():
        raise FileNotFoundError(f"Docs directory not found: {docs_dir}")

    pdf_files = list(docs_dir.glob("*.pdf"))
    valid_items = []
    missing_bibs = []

    for pdf_path in pdf_files:
        bib_path = pdf_path.with_suffix(".bib")
        
        if not bib_path.exists():
            missing_bibs.append(pdf_path.name)
            # Still add to items, but with default metadata
            default_meta = {
                "source": pdf_path.name,
                "title": pdf_path.stem,
                "year": "Unknown", 
                "type": "document"
            }
            valid_items.append({"path": pdf_path, "meta": default_meta})
        else:
            meta = parse_bib_file(bib_path, pdf_path.name)
            valid_items.append({"path": pdf_path, "meta": meta})

    return valid_items, missing_bibs

def truncate_database(supabase: Client):
    """Deletes all rows from the documents table."""
    print("\n[Action] Truncating 'documents' table...")
    # There is no direct 'truncate' in JS/Python SDK, usually delete with filter is used.
    # Since we can't delete without a WHERE clause usually, we check count or use a broad filter.
    # Note: In production Supabase, 'neq' (not equal) 0 works for ID usually.
    try:
        supabase.table("documents").delete().neq("id", 0).execute()
        print("  ✓ Table cleared.")
    except Exception as e:
        print(f"  [Error] Failed to truncate table: {e}")

def get_embedding(text: str) -> List[float]:
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type="retrieval_document",
    )
    return result["embedding"]

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 100) -> List[str]:
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
    return response == 'y'

def main():
    args = parse_arguments()
    
    # 1. Scan Files
    print(f"Scanning directory: {args.docs_dir} ...")
    items, missing_bibs = scan_documents(args.docs_dir)

    if not items:
        print("No PDF files found.")
        return

    # 2. Check Missing Bibs
    if missing_bibs:
        print("\n" + "!" * 50)
        print("WARNING: The following PDFs are missing .bib files:")
        for name in missing_bibs:
            print(f"  - {name}")
        print("!" * 50)
        
        if not confirm_action("Do you want to continue without metadata for these files?"):
            print("Aborted.")
            sys.exit(0)

    # 3. Review Metadata
    print("\n" + "=" * 60)
    print(f"{'FILENAME':<35} | {'YEAR':<6} | {'TITLE'}")
    print("-" * 60)
    for item in items:
        m = item['meta']
        # Truncate long titles for display
        display_title = (m['title'][:40] + '..') if len(m['title']) > 40 else m['title']
        print(f"{m['source']:<35} | {m['year']:<6} | {display_title}")
    print("=" * 60)
    print(f"Total files to ingest: {len(items)}")

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
    for item in items:
        file_path = item['path']
        metadata = item['meta']
        
        print(f"Processing: {file_path.name}")
        
        try:
            reader = PdfReader(str(file_path))
            full_text = ""
            for page in reader.pages:
                text = page.extract_text()
                if text: full_text += text + "\n"
                
            chunks = chunk_text(full_text)
            
            for i, chunk in enumerate(chunks):
                try:
                    embedding = get_embedding(chunk)
                    data = {
                        "content": chunk,
                        "metadata": {**metadata, "chunk_index": i},
                        "embedding": embedding
                    }
                    supabase.table("documents").insert(data).execute()
                    
                    if i % 5 == 0:
                        print(f"  - Chunk {i}/{len(chunks)}", end="\r")
                        
                except Exception as e:
                    print(f"  [Error] Chunk {i} failed: {e}")
            print("") # New line after chunks
            
        except Exception as e:
            print(f"  [Error] Failed to read PDF: {e}")

    print("\n✅ Ingestion Complete!")

if __name__ == "__main__":
    main()