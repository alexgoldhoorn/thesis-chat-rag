-- Adds an optional source filter to match_documents (document focus, ?doc=).
-- Creates the four-argument overload next to the old three-argument one. While
-- both exist a three-argument call is ambiguous, so deploy the new app (which
-- always calls the four-argument form) right after applying this, then 0002.
-- Idempotent. Apply as the postgres superuser:
--   docker exec -i thesis-chat-db psql -U postgres -d thesis < db/migrations/0001-match-documents-source-filter.sql
\set ON_ERROR_STOP on

create or replace function match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  filter_source text default null
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
set search_path = public
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
    and (filter_source is null or d.metadata->>'source' = filter_source)
  order by similarity desc
  limit least(match_count, 20);
$$;

revoke all on function match_documents(vector, float, int, text) from public;
grant execute on function match_documents(vector, float, int, text) to chat_ro;
