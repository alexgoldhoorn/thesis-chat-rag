import { pool } from "@/app/lib/db";
import { docUrl, slugOf, type DocInfo } from "@/app/lib/focus";

// The ingested documents, one per source file. The corpus only changes on
// re-ingestion, so the list is cached in memory; a restart clears it.
export type IngestedDoc = DocInfo & { source: string };

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; docs: Promise<IngestedDoc[]> } | null = null;

async function loadDocs(): Promise<IngestedDoc[]> {
  // Lowest chunk id wins if chunks of one source ever disagree on metadata.
  const { rows } = await pool.query<{
    metadata: Record<string, string | undefined>;
  }>(
    `select distinct on (metadata->>'source') metadata
       from documents
      where metadata->>'source' is not null
      order by metadata->>'source', id`
  );
  return rows
    .map(({ metadata: meta }) => ({
      slug: slugOf(meta.source!),
      source: meta.source!,
      title: meta.title || meta.source!,
      year: meta.year || "n.d.",
      type: meta.type || "Document",
      url: docUrl(meta),
    }))
    .sort((a, b) => b.year.localeCompare(a.year) || a.title.localeCompare(b.title));
}

// Throws on a database error and leaves the cache empty, so callers can answer
// 503 instead of treating every slug as unknown.
export function getDocs(): Promise<IngestedDoc[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.docs;
  const entry = { at: Date.now(), docs: loadDocs() };
  cache = entry;
  entry.docs.catch(() => {
    if (cache === entry) cache = null;
  });
  return entry.docs;
}
