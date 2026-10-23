# thesis-chat-rag

A RAG (Retrieval-Augmented Generation) chat app that lets users ask questions about my PhD thesis and published papers. Built with Next.js, Supabase (pgvector), Claude (answers) and Google Gemini (embeddings).

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, AI SDK 7
- **AI:** Claude Opus 5.5 via `@ai-sdk/anthropic` (LLM, configurable with `CHAT_MODEL`), Google `gemini-embedding-001` at 768 dimensions (embeddings)
- **Database:** Supabase PostgreSQL + pgvector (768-dim cosine similarity)
- **Ingestion:** Python scripts for PDF parsing, chunking, and embedding

## Setup

### Prerequisites

- Node.js 20.9+
- Python 3.12+ (for data ingestion)
- Supabase project with pgvector extension
- Anthropic API key and Google AI API key

### Environment Variables

Copy the example and fill in your keys:

```bash
cp .env.example .env.local
```

| Variable | Used by | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js + Python ingestion | [Supabase Dashboard](https://supabase.com/dashboard) → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js (vector search) | Same page, "anon public" key |
| `SUPABASE_SERVICE_ROLE_KEY` | Python ingestion only | Same page, "service_role" key |
| `ANTHROPIC_API_KEY` | AI SDK (LLM answers) | [Claude Console](https://platform.claude.com/settings/keys) |
| `CHAT_MODEL` (optional) | Claude model id, default `claude-opus-5-5` | e.g. `claude-sonnet-5-5`, `claude-haiku-5-5` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | AI SDK (query embeddings) + Python ingestion | [Google AI Studio](https://aistudio.google.com/apikey) |

### Database

Run `thesis-rag.sql` in your Supabase SQL editor to create the `documents` table and `match_documents` function.

### Data Ingestion

```bash
cd scripts
uv sync
python ingest.py --docs-dir ../docs
```

This extracts text from PDFs in `docs/`, chunks it, generates embeddings, and stores everything in Supabase.

When the embedding model changes, re-ingest everything with `--truncate`: vectors from different models are not comparable.

### Run

```bash
npm install
npm run dev
```

## How It Works

1. User sends a message
2. The message is embedded using Google's embedding model
3. Top 5 matching document chunks are retrieved via vector similarity search
4. Chunks + metadata are passed as context to Claude
5. Claude streams a response with citations back to the user
