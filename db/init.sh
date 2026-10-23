#!/bin/bash
# Runs once, on the first start of an empty Postgres data directory
# (/docker-entrypoint-initdb.d). Creates the schema and two roles:
#   chat_ro — used by the public app: can only read documents and call match_documents
#   ingest  — used by scripts/ingest.py from the host: can write documents
set -euo pipefail

: "${CHAT_DB_PASSWORD:?}" "${INGEST_DB_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v chat_pw="$CHAT_DB_PASSWORD" -v ingest_pw="$INGEST_DB_PASSWORD" <<'SQL'
create extension if not exists vector;

-- Must match the embedding dimension in app/api/chat/route.ts and scripts/ingest.py.
create table documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding vector(768)
);

create or replace function match_documents (
  query_embedding vector(768),
  match_threshold float,
  match_count int
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
  order by similarity desc
  limit least(match_count, 20);
$$;

revoke all on schema public from public;
revoke all on function match_documents(vector, float, int) from public;

create role chat_ro login password :'chat_pw';
grant connect on database :"DBNAME" to chat_ro;
grant usage on schema public to chat_ro;
grant select on documents to chat_ro;
grant execute on function match_documents(vector, float, int) to chat_ro;

create role ingest login password :'ingest_pw';
grant connect on database :"DBNAME" to ingest;
grant usage on schema public to ingest;
grant select, insert, update, delete, truncate on documents to ingest;
grant usage on sequence documents_id_seq to ingest;
SQL
