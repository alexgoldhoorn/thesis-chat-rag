import os
import glob
from typing import List

# Third-party imports
import google.generativeai as genai
from supabase import create_client, Client
from pypdf import PdfReader
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL not found. Please set it in your .env file")
if not SUPABASE_KEY:
    raise ValueError("SUPABASE_SERVICE_ROLE_KEY not found. Please set it in your .env file")

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
genai.configure(api_key=GOOGLE_API_KEY)


def get_embedding(text: str) -> List[float]:
    # Generate embedding using the requested model
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type="retrieval_document",
    )
    return result["embedding"]


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 100) -> List[str]:
    # Simple sliding window chunking to avoid LangChain dependency
    chunks = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    
    return chunks


def process_documents():
    # Find all PDFs in the docs folder
    pdf_files = glob.glob("../docs/*.pdf")
    
    print(f"Found {len(pdf_files)} PDF(s) to process...")

    for file_path in pdf_files:
        print(f"Processing: {file_path}")
        reader = PdfReader(file_path)
        full_text = ""

        # Extract text from all pages
        for page in reader.pages:
            full_text += page.extract_text() + "\n"

        chunks = chunk_text(full_text)
        
        for i, chunk in enumerate(chunks):
            # Generate embedding for the chunk
            embedding = get_embedding(chunk)
            
            data = {
                "content": chunk,
                "metadata": {"source": file_path, "chunk_index": i},
                "embedding": embedding
            }

            # Insert into Supabase
            supabase.table("documents").insert(data).execute()
            
            # Print progress every 10 chunks to keep console clean
            if i % 10 == 0:
                print(f"  - Indexed chunk {i}/{len(chunks)}")

    print("Ingestion complete.")


if __name__ == "__main__":
    process_documents()