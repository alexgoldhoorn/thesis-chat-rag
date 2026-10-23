# CLAUDE.md

## Project Overview

RAG chat application for querying a PhD thesis and academic papers. Next.js 16 frontend with a single API route that performs vector search and streams AI responses.

## Architecture

```
app/page.tsx          → Chat UI (React client component)
app/api/chat/route.ts → RAG endpoint: embed query → vector search → stream LLM response
app/layout.tsx        → Root layout
scripts/ingest.py     → PDF ingestion pipeline (Python)
docs/                 → Source PDFs + BibTeX metadata files
db/init.sh            → Database schema + roles (pgvector, first container start)
Dockerfile            → Standalone production image
```

## Key Technical Details

- **Embeddings:** Google `gemini-embedding-001` with `outputDimensionality` 768 (`@ai-sdk/google` in the route, `google-genai` in ingestion; keep both in sync)
- **LLM:** Claude via `@ai-sdk/anthropic`, model from `CHAT_MODEL` (default `claude-opus-5-5`), effort `low`, `fallbacks: "default"`
- **Vector search:** Postgres `match_documents` via `pg` (read-only `chat_ro` role) with cosine similarity, threshold 0.1, top 5 results
- **Chunking:** 1000 chars with 100 char overlap (done in Python ingestion)
- **Streaming:** AI SDK `streamText` → `toUIMessageStream` → `createUIMessageStreamResponse`

## Commands

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run lint      # ESLint
```

## Environment Variables

Required in `.env`:
- `DATABASE_URL` (read-only `chat_ro` role)
- `INGEST_DATABASE_URL` (used only in ingestion script)
- `ANTHROPIC_API_KEY`
- `CHAT_MODEL` (optional)
- `DAILY_ANSWER_LIMIT` (optional, default 200 answers/day across all visitors)
- `GOOGLE_GENERATIVE_AI_API_KEY`

## Conventions

- TypeScript strict mode
- Path alias: `@/*` maps to project root
- Tailwind CSS for styling
- AI SDK v7 for LLM/embedding integration (UI messages use `parts`, not `content`)
