# CLAUDE.md

## Project Overview

RAG chat application for querying a PhD thesis and academic papers. Next.js 14 frontend with a single API route that performs vector search and streams AI responses.

## Architecture

```
app/page.tsx          → Chat UI (React client component)
app/api/chat/route.ts → RAG endpoint: embed query → vector search → stream LLM response
app/layout.tsx        → Root layout
scripts/ingest.py     → PDF ingestion pipeline (Python)
docs/                 → Source PDFs + BibTeX metadata files
thesis-rag.sql        → Database schema (pgvector)
```

## Key Technical Details

- **Embeddings:** Google Text-Embedding-004, 768 dimensions
- **LLM:** Gemini 2.5-Flash via `@ai-sdk/google`
- **Vector search:** Supabase RPC `match_documents` with cosine similarity, threshold 0.1, top 5 results
- **Chunking:** 1000 chars with 100 char overlap (done in Python ingestion)
- **Streaming:** AI SDK `streamText` with Server-Sent Events

## Commands

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run lint      # ESLint
```

## Environment Variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (used only in ingestion script)
- `GOOGLE_GENERATIVE_AI_API_KEY`

## Conventions

- TypeScript strict mode
- Path alias: `@/*` maps to project root
- Tailwind CSS for styling
- AI SDK v4 for LLM/embedding integration
