# CLAUDE.md

## Project Overview

RAG chat application for querying a PhD thesis and academic papers. Next.js 16 frontend with a single API route that performs vector search and streams AI responses.

## Architecture

```
app/page.tsx          → Reads ?doc= / ?q= and renders the chat
app/chat.tsx          → Chat UI (React client component), focus chip
app/api/chat/route.ts → RAG endpoint: embed query → vector search → stream LLM response
app/api/docs/route.ts → Ingested document list (slugs for ?doc= links)
app/lib/              → db pool, cached document list, pure focus helpers (+ Vitest tests)
app/layout.tsx        → Root layout
scripts/ingest.py     → PDF ingestion pipeline (Python)
docs/                 → Source PDFs + BibTeX metadata files
db/init.sh            → Database schema + roles (pgvector, first container start)
db/migrations/        → Hand-applied SQL for the existing production database
Dockerfile            → Standalone production image
```

## Key Technical Details

- **Embeddings:** Google `gemini-embedding-001` with `outputDimensionality` 768 (`@ai-sdk/google` in the route, `google-genai` in ingestion; keep both in sync)
- **LLM:** Claude via `@ai-sdk/anthropic`, model from `CHAT_MODEL` (default `claude-opus-5-5`), effort `low`, `fallbacks: "default"`
- **Vector search:** Postgres `match_documents(embedding, threshold, count, filter_source)` via `pg` (read-only `chat_ro` role) with cosine similarity, threshold 0.1, top 5 results. Always call the four-argument form.
- **Document focus:** `?doc=<slug>` (slug = `metadata.source` minus extension). Focused: 6 chunks from that source + 3 general; unknown slug → 400. Spec: `docs/superpowers/specs/2026-10-26-document-focus-design.md`
- **arXiv tool:** `arxiv_search` (`app/lib/arxiv.ts`), abstracts only, max 2 searches per answer (per-request counter + `toolChoice: "none"` on the last step), 3 s global spacing, 1 h cache. `ARXIV_SEARCH=off` disables it
- **Chunking:** 1000 chars with 100 char overlap (done in Python ingestion)
- **Streaming:** AI SDK `streamText` → `toUIMessageStream` → `createUIMessageStreamResponse`

## Commands

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run lint      # ESLint
npm test          # Vitest (app/lib/*.test.ts)
```

## Environment Variables

Required in `.env`:
- `DATABASE_URL` (read-only `chat_ro` role)
- `INGEST_DATABASE_URL` (used only in ingestion script)
- `ANTHROPIC_API_KEY`
- `CHAT_MODEL` (optional)
- `DAILY_ANSWER_LIMIT` (optional, default 200 answers/day across all visitors)
- `ARXIV_SEARCH` (optional, `off` disables the arXiv search tool)
- `GOOGLE_GENERATIVE_AI_API_KEY`

## Conventions

- TypeScript strict mode
- Path alias: `@/*` maps to project root
- Tailwind CSS for styling
- AI SDK v7 for LLM/embedding integration (UI messages use `parts`, not `content`)
