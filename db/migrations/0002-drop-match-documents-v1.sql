-- Drops the old three-argument match_documents. Apply only after the app that
-- calls the four-argument form (0001) is live. Idempotent. Apply as postgres:
--   docker exec -i thesis-chat-db psql -U postgres -d thesis < db/migrations/0002-drop-match-documents-v1.sql
\set ON_ERROR_STOP on

drop function if exists match_documents(vector, float, int);
