-- Move pgvector to a dedicated schema (out of public)
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Create a table to store thesis content
create table documents (
  id bigserial primary key,
  content text,
  metadata jsonb,
  embedding extensions.vector(768)
);

-- Enable RLS and allow read-only access via anon key
alter table documents enable row level security;

create policy "Allow public read access"
  on documents for select
  using (true);

-- Search function with immutable search_path
create or replace function match_documents (
  query_embedding extensions.vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
set search_path = ''
as $$
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.documents d
  where 1 - (d.embedding operator(extensions.<=>) query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
end;
$$;
