# thesis-chat-rag

A RAG (Retrieval-Augmented Generation) chat app that lets users ask questions about my PhD thesis and published papers. Built with Next.js, Postgres (pgvector), Claude (answers) and Google Gemini (embeddings).

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS, AI SDK 7
- **AI:** Claude Opus 5.5 via `@ai-sdk/anthropic` (LLM, configurable with `CHAT_MODEL`), Google `gemini-embedding-001` at 768 dimensions (embeddings)
- **Database:** PostgreSQL 17 + pgvector (768-dim cosine similarity), self-hosted with Docker
- **Ingestion:** Python scripts for PDF parsing, chunking, and embedding

## Setup

### Prerequisites

- Node.js 20.9+
- Python 3.12+ (for data ingestion)
- Docker (Postgres + pgvector, and the app image)
- Anthropic API key and Google AI API key

### Environment Variables

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

`.env` is read by `next dev` and by `scripts/ingest.py`.

| Variable | Used by | Where to get it |
|---|---|---|
| `DATABASE_URL` | Next.js (vector search) | Read-only `chat_ro` role, see Database |
| `INGEST_DATABASE_URL` | Python ingestion only | `ingest` role (write access) |
| `ANTHROPIC_API_KEY` | AI SDK (LLM answers) | [Claude Console](https://platform.claude.com/settings/keys) |
| `CHAT_MODEL` (optional) | Claude model id, default `claude-opus-5-5` | e.g. `claude-sonnet-5-5`, `claude-haiku-5-5` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | AI SDK (query embeddings) + Python ingestion | [Google AI Studio](https://aistudio.google.com/apikey) |

### Database

Use the `pgvector/pgvector:pg17` image and mount `db/init.sh` into `/docker-entrypoint-initdb.d/`. On the first start of an empty data directory it creates the `documents` table, the `match_documents` function and two roles, with passwords from `CHAT_DB_PASSWORD` and `INGEST_DB_PASSWORD`:

- `chat_ro`: used by the app; can only read `documents` and call `match_documents`
- `ingest`: used by `scripts/ingest.py`; can write `documents`

### Data Ingestion

```bash
cd scripts
uv sync
python ingest.py --docs-dir ../docs
```

This extracts text from PDFs in `docs/`, chunks it, generates embeddings, and stores everything in Postgres.

When the embedding model changes, re-ingest everything with `--truncate`: vectors from different models are not comparable.

### Run

```bash
npm install
npm run dev
```

### Deploy

The `Dockerfile` builds a Next.js standalone image. Runtime config (`DATABASE_URL`, API keys) comes from the environment; nothing secret is baked into the image.

The public route caps each request: question length, history length and answer length.

## How It Works

1. User sends a message
2. The message is embedded using Google's embedding model
3. Top 5 matching document chunks are retrieved via vector similarity search
4. Chunks + metadata are passed as context to Claude
5. Claude streams a response with citations back to the user
