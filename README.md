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
| `DAILY_ANSWER_LIMIT` (optional) | Max answers per day across all visitors, default 200 | Spend backstop for the public route |
| `GOOGLE_GENERATIVE_AI_API_KEY` | AI SDK (query embeddings) + Python ingestion | [Google AI Studio](https://aistudio.google.com/apikey) |

### Database

Use the `pgvector/pgvector:pg17` image and mount `db/init.sh` into `/docker-entrypoint-initdb.d/`. On the first start of an empty data directory it creates the `documents` table, the `match_documents` function and two roles, with passwords from `CHAT_DB_PASSWORD` and `INGEST_DB_PASSWORD`:

- `chat_ro`: used by the app; can only read `documents` and call `match_documents`
- `ingest`: used by `scripts/ingest.py`; can write `documents`

`init.sh` runs only on an empty data directory, so schema changes for an existing database ship as numbered files in `db/migrations/` (idempotent, applied by hand as the `postgres` superuser, in order, following the deploy notes at the top of each file):

```bash
docker exec -i thesis-chat-db psql -U postgres -d thesis < db/migrations/0001-match-documents-source-filter.sql
```

`init.sh` always holds the current schema, so a fresh install needs no migrations.

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
npm test          # unit tests (Vitest)
```

### Deploy

The `Dockerfile` builds a Next.js standalone image. Runtime config (`DATABASE_URL`, API keys) comes from the environment; nothing secret is baked into the image.

The public route caps each request (question length, history length, answer length) and the whole day (`DAILY_ANSWER_LIMIT`).

## Document focus links

`https://chat.goldhoorn.net/?doc=<slug>` opens the chat focused on one document; `&q=<question>` prefills the input (it is never sent automatically). The slug is the ingested filename without its extension; `GET /api/docs` lists every slug with its title, year, type and URL.

In focus mode retrieval takes up to 6 chunks from that document plus up to 3 from the rest of the corpus, and the prompt tells the model which document the visitor is reading. An unknown slug is a 400 from the API and a visible notice on the page, never a silent fallback.

## How It Works

1. User sends a message
2. The message is embedded using Google's embedding model
3. Top 5 matching document chunks are retrieved via vector similarity search
4. Chunks + metadata are passed as context to Claude
5. Claude streams a response with citations back to the user
