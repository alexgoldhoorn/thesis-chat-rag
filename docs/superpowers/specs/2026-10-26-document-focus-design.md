# Document focus: "Ask about this paper" links into the research chat

Date: 2026-10-26. Status: built 2026-10-26 (branch `feat/document-focus`), not deployed.

## Intent

A visitor reading one paper or article on alex.goldhoorn.net should be able to
click "Ask about this" and land in the chat with that document in focus: the
retrieval prefers it, the model knows which document is open, and the page says
so. The chat stays a general door to the whole corpus; focus is a preference,
not a wall.

Today the chat has one entry point, `https://chat.goldhoorn.net`, no URL
parameters, and retrieval over the whole corpus. The site links to it from the
publications page, the thesis page, the articles index and four posts (the
`.chat-strip` element added 2026-10-26), each with an example question the
visitor has to retype.

## Goals

1. `https://chat.goldhoorn.net/?doc=<slug>` opens the chat focused on one
   ingested document, visibly, with a one-click way back to the general chat.
2. `&q=<question>` prefills the input (not sent) so the site's example
   questions become one click.
3. Retrieval in focus mode favours the focused document but can still see the
   rest of the corpus, so "how does this compare to your 2014 paper?" works.
4. The slug is stable, derived from data the site and the database already
   share, and needs no re-ingestion.
5. The public route stays as bounded as it is today: no new way to spend
   answers, probe the database or inject into SQL.

## Non-goals and anti-goals

- No iframe embedding of the chat into site pages.
- No auto-sending of `q`: a crawler or link preview following the URL must
  not consume one of the daily answer slots.
- No hard filter that hides the rest of the corpus (see goal 3).
- No per-document system prompts, summaries or canned answers.
- No changes to chunking, embeddings or the ingestion script's output.
- A failure mode to avoid: an unknown or stale `doc` value that silently
  behaves like the general chat while the page still claims focus. Unknown
  must be visible, both in the UI and in the API response.

## Constraints

- Next.js 16, AI SDK v7 (UI messages use `parts`), TypeScript strict,
  Tailwind. Single API route at `app/api/chat/route.ts`, single client page at
  `app/page.tsx`. See `CLAUDE.md`.
- The app connects as `chat_ro`, which can only `select` on `documents` and
  `execute` `match_documents`. Keep it that way.
- `db/init.sh` runs only on the first start of an empty data directory. The
  production database (`~/dockers/thesis-chat-rag`, container `thesis-chat-db`)
  already exists, so any SQL change needs a migration applied by hand with the
  `postgres` superuser, plus the same change in `init.sh` for fresh installs.
- The public route is rate-limited by Nginx Proxy Manager (bursts return a
  429 HTML page) and by the in-memory daily cap (`DAILY_ANSWER_LIMIT`).
- Production is `read_only: true` with `cap_drop: [ALL]`; nothing may write to
  disk at runtime.

## The document key

`metadata->>'bibtex_id'` is **not** unique: the thesis and the 2017
Autonomous Robots article both carry `Goldhoorn2017`, and the RAS article
carries `GOLDHOORN2017`. `metadata->>'source'` (the ingested filename) is
unique per document and is what the route already uses to build fallback
URLs.

**Slug = `source` without its extension**, exact match, case-sensitive.
Examples:

| Slug | Source |
|---|---|
| `Goldhoorn2017_PhD_thesis` | `Goldhoorn2017_PhD_thesis.pdf` |
| `Goldhoorn2017-RAS-SearchingAndTrackingPeopleInUrbanEnvironments` | `…​.pdf` |
| `Goldhoorn2026-Article-LLM-Coding-Patterns` | `…​.txt` |

Accepted shape: `^[A-Za-z0-9._-]{1,120}$`. Anything else is rejected before it
reaches the database. A slug that passes the shape check but matches no
document is "unknown", not an error of shape.

The slug is long but it is the one key that exists on both sides today
(the site's `publications/dl/*.pdf` filenames are the same files). A shorter
alias layer can be added later without changing this contract.

## Parts

### 1. Database: optional source filter on `match_documents`

Add a fourth parameter, `filter_source text default null`. With `null` the
function behaves exactly as today. With a value, only chunks whose
`metadata->>'source'` equals it are considered.

- Postgres treats a new signature as a new overload, and while both exist a
  three-argument call is ambiguous ("function is not unique"). So the app
  always calls the **four-argument form explicitly** (`null` for general), and
  the change ships as two migrations:
  `0001-match-documents-source-filter.sql` creates the four-parameter
  function with `revoke all … from public` and `grant execute … to chat_ro`
  on the new signature; `0002-drop-match-documents-v1.sql` drops the old
  three-argument one and is applied only after the new app is live. Both are
  idempotent (`create or replace`, `drop function if exists`).
- Keep `limit least(match_count, 20)`.
- `db/init.sh` is updated to create only the four-parameter version, so a
  fresh install matches. `README.md` documents how to apply a migration:
  `docker exec -i thesis-chat-db psql -U postgres -d thesis < db/migrations/0001-….sql`.

### 2. API: document list

`GET /api/docs` returns the ingested documents as JSON:

```json
[{"slug": "Goldhoorn2017_PhD_thesis", "title": "Searching and Tracking of Humans …",
  "year": "2017", "type": "phdthesis", "url": "https://…/Goldhoorn2017_PhD_thesis.pdf"}]
```

- Built with `select distinct on (metadata->>'source') … order by
  metadata->>'source', id`, so one row per source (the lowest chunk id wins
  if chunks ever disagree on title or year). `url` follows the same fallback
  rule the chat route uses today (`metadata.url`, else
  `https://alex.goldhoorn.net/publications/dl/<source>`).
- Known data gap, pre-existing and out of scope: three ingested PDFs
  (`Goldhoorn2006-Ants-…`, `Goldhoorn2006-Evolving-RoboCode-…`,
  `Goldhoorn-Mental-Counting-…`) have no `url` and no file under
  `publications/dl/`, so their fallback links 404 in citations already. The
  fix is a `url` field in those `.bib` files plus a metadata update, as a
  separate task. The chip and `/api/docs` simply use the same rule; this
  build does not try to detect dead links.
- Cached in memory for 10 minutes (the corpus changes only on re-ingestion;
  a restart clears it). Served with `Cache-Control: public, max-age=600`.
  If the query fails, the cache is not populated and the caller gets a 503
  `{"error": "The chat is temporarily unavailable."}`; a database error must
  never surface as "Unknown document".
- Read-only and cheap, so no daily-slot accounting. It does expose the list
  of document titles, which the site already publishes.

The chat route reuses the same cached list to validate `doc`. One module
(`app/lib/docs.ts` or similar; the builder's call) owns the query, the cache
and `slugOf(source)`.

### 3. API: focus-aware retrieval in `POST /api/chat`

Request body gains an optional `doc: string`. Validation order, before any
embedding call or daily-slot use:

1. Shape check against the regex above; a bad shape is a 400
   `{"error": "Invalid document."}`.
2. Lookup in the cached document list; unknown is a 400
   `{"error": "Unknown document."}`. Never pass a slug that failed lookup to
   SQL.

Retrieval when `doc` is set (soft focus):

- Focused: `match_documents(embedding, 0.1, 6, source)`.
- General: `match_documents(embedding, 0.1, 3, null)`, dropping any row whose
  `metadata->>'source'` is the focused source and any id already in the
  focused set.
- Context order: focused chunks first, then the general ones. Total stays
  within the current 20-row cap and roughly the same prompt size as today
  (today: 5 chunks; focus: up to 9). `MAX_OUTPUT_TOKENS` is unchanged.
- The two queries may run in parallel.

System prompt gains one paragraph when focused, inserted before the context:

> The visitor opened this chat from "{Title} ({Year})" and is reading it.
> Treat questions as being about that document unless they say otherwise.
> When you draw on a different source, say so and cite it.

If the focused query returns no rows (nothing in that document clears the
0.1 threshold, e.g. "who is Alex?"), the threshold stays as it is and the
paragraph changes instead:

> The visitor opened this chat from "{Title} ({Year})", but no passage of it
> matched this question. Answer from the sources below and say that the
> answer does not come from that document.

Without `doc`, retrieval, prompt and behaviour are unchanged apart from the
explicit four-argument SQL call. Daily-slot accounting is unchanged: one slot
per answer, focused or not. Conversation history is sent unchanged across a
focus change; no "context changed" marker is added to the transcript.

### 4. Page: focus chip and prefill

`app/page.tsx` reads `doc` and `q` from the URL on mount (a client
component; `useSearchParams` inside a `Suspense` boundary, or
`window.location` in an effect, builder's call).

- On load with `doc`, fetch `/api/docs` and resolve the slug. Known: render a
  chip under the header: `Focused on: {Title} ({Year})` with a ✕ button. The
  chip links the title to the document URL (new tab). Unknown: render a
  dismissable notice `That document isn't in the chat's library; asking the
  whole collection instead.` and continue unfocused.
- While focused, every `sendMessage` carries `doc` in the request body (AI
  SDK v7: `sendMessage({ text }, { body: { doc } })`). Clearing the chip stops
  sending it and removes `doc` from the URL (`history.replaceState`), so a
  reload is general again. Existing messages stay in the transcript.
- `q`: prefill the input, never auto-send. Cap at `MAX_QUESTION_CHARS`
  (1000) client-side; the route still enforces it.
- Empty-state suggestions while focused become document-flavoured
  ("What is the main contribution of this paper?", "Which methods does it
  compare?", "What were the experimental results?"). Generic ones remain for
  the unfocused state.
- The header copy is unchanged.

### 5. Site contract (built separately, in alex.goldhoorn.net)

Not part of this build, recorded so both sides agree:

- Per publication, thesis and article: a small `Ask about this →` link next to
  the existing PDF/BibTeX links, `href="https://chat.goldhoorn.net/?doc=<slug>"`,
  `target="_blank" rel="noopener"`.
- The existing `.chat-strip` examples add `&q=<url-encoded question>` to their
  links, and the thesis/post strips add `doc=` too.
- Slugs for papers equal the filenames in `publications/dl/` minus the
  extension; article slugs are the ingested `.txt` names (e.g.
  `Goldhoorn2026-Article-LLM-Coding-Patterns`), which the site does not host.
  `GET /api/docs` is the authoritative list. The site is static HTML, so its
  author copies slugs from one `curl https://chat.goldhoorn.net/api/docs` at
  authoring time; no build-time integration and no slug mapping file is a
  deliverable of this build.

## Verification

Manual checks the builder runs against `npm run dev` with the production
database on `127.0.0.1:5433` (read-only role), before and after the migration:

1. `GET /api/docs` lists 24 documents today, each with a unique slug.
2. `POST /api/chat` without `doc`: identical answers to today (5 chunks,
   same threshold; the only difference is the explicit `null` fourth
   argument).
3. With `doc=Goldhoorn2017_PhD_thesis` and "What is the main contribution?":
   the answer cites the thesis; the server log shows 6 focused + up to 3
   general rows.
4. With `doc=Goldhoorn2014-Humanoid-Continuous-real-time-POMCP-find-and-follow`
   and "How does this compare to the 2017 journal version?": the answer cites
   both and says it is drawing on a second source.
5. `doc=../etc` → 400 Invalid; `doc=Nope2020` → 400 Unknown; neither consumes
   a daily slot (check the counter via two follow-up valid calls, or a log
   line).
6. Page: `/?doc=Goldhoorn2017_PhD_thesis&q=Why%20POMCP` shows the chip and the
   prefilled input, nothing is sent; ✕ clears the chip and the URL; reload is
   general. `/?doc=Nope` shows the notice and works unfocused.
7. `npm run lint` and `npm run build` pass; the Docker image builds and runs
   read-only as before.

Automated tests: the repo has none today. Adding a minimal Vitest setup for
`slugOf`, the shape regex and the focused/general merge is encouraged but
left to the builder; the manual list above is the acceptance bar.

## Deployment order

1. Build the new image first: `cd ~/dockers/thesis-chat-rag && docker compose
   build app`.
2. Apply `0001` to `thesis-chat-db` (superuser, one command, idempotent) and
   immediately `docker compose up -d app`. The old app's three-argument call
   becomes ambiguous the moment the four-argument overload exists, so the
   two commands run back to back and the broken window is seconds.
3. Run checks 1, 3 and 6 against `https://chat.goldhoorn.net` (sequentially,
   the proxy rate-limits bursts).
4. Apply `0002` (drop the three-argument function). Re-run check 2.
5. Only then change the site links.

## Left to the builder

- File and module names, the Suspense/`useSearchParams` choice, chip styling
  within the existing Tailwind palette.
- Whether to add Vitest.
- Whether `/api/docs` sorts by year or by title.
- The exact wording of the focused empty-state suggestions.

## Decisions made here, for the record

- Key by `source` filename stem, not `bibtex_id` (not unique) and not a new
  id (would need re-ingestion).
- Soft focus (6 + 3) rather than a hard filter, so cross-document questions
  keep working.
- `q` prefills and never auto-sends, to protect the daily cap from crawlers.
- Unknown `doc` is loud (400 on the API, a notice on the page), never a silent
  fallback.
- A separate `GET /api/docs` rather than embedding the list at build time,
  because the corpus lives in the database and changes on re-ingestion, not
  on deploy.
- Resolved after the builder check (2026-10-26): two migrations and an
  explicit four-argument call, to avoid the overload ambiguity; a 503 on a
  database error so it never reads as "unknown"; `distinct on (source)` with
  lowest id winning; an empty focused set switches the prompt paragraph rather
  than lowering the threshold; history is sent unchanged across focus changes;
  the three dead fallback URLs are a pre-existing data gap handled separately.
