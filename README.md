# thesis-chat-rag

A RAG (Retrieval-Augmented Generation) chat app that lets users ask questions about my PhD thesis and published papers. Built with Next.js, Supabase (pgvector), and Google Gemini.

## Tech Stack

- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **AI:** Google Gemini 2.5-Flash (LLM), Text-Embedding-004 (embeddings)
- **Database:** Supabase PostgreSQL + pgvector (768-dim cosine similarity)
- **Ingestion:** Python scripts for PDF parsing, chunking, and embedding

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+ (for data ingestion)
- Supabase project with pgvector extension
- Google AI API key

### Environment Variables

Create a `.env.local` file:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### Database

Run `thesis-rag.sql` in your Supabase SQL editor to create the `documents` table and `match_documents` function.

### Data Ingestion

```bash
cd scripts
pip install -r requirements.txt  # or use uv
python ingest.py --docs-dir ../docs
```

This extracts text from PDFs in `docs/`, chunks it, generates embeddings, and stores everything in Supabase.

### Run

```bash
npm install
npm run dev
```

## How It Works

1. User sends a message
2. The message is embedded using Google's embedding model
3. Top 5 matching document chunks are retrieved via vector similarity search
4. Chunks + metadata are passed as context to Gemini
5. Gemini streams a response with citations back to the user
