// Semantic Scholar Graph API for the chat's scholar_* tools: find a paper by
// title or id, list its references or citations, keyword search. Covers
// conference and journal papers that are not on arXiv. Keyless requests share
// one public pool (search is usually rate-limited without a key), so set
// SEMANTIC_SCHOLAR_API_KEY for reliable use; keyed limit is 1 request/second.
import { Throttle, TtlCache, truncate } from "./external";

const API_URL = "https://api.semanticscholar.org/graph/v1";
const API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY;
const TIMEOUT_MS = 8000;
const MAX_ABSTRACT_CHARS = 1200;
const MAX_AUTHORS = 5;
const SEARCH_RESULTS = 5;
const LINK_RESULTS = 10;

const PAPER_FIELDS =
  "title,year,authors,venue,abstract,tldr,citationCount,externalIds,url";
const LINK_FIELDS = "title,year,authors,venue,citationCount,externalIds";

export type ScholarPaper = {
  id: string;
  title: string;
  authors: string[];
  year: string;
  venue: string;
  citations: number | null;
  url: string;
  abstract?: string;
};

type RawPaper = {
  paperId?: string | null;
  title?: string | null;
  year?: number | null;
  venue?: string | null;
  authors?: { name?: string | null }[] | null;
  abstract?: string | null;
  tldr?: { text?: string | null } | null;
  citationCount?: number | null;
  externalIds?: Record<string, string | number> | null;
  url?: string | null;
};

// "DOI:10.1007/...", "ARXIV:2303.09172", or a 40-hex Semantic Scholar id.
// Checked before use, so the id goes into the URL path unescaped.
export const PAPER_ID_PATTERN =
  /^(?:[0-9a-f]{40}|(?:DOI|ARXIV|CorpusId|DBLP|ACL|PMID):[A-Za-z0-9._\/:;()-]{1,150})$/;

export function toPaper(raw: RawPaper, withAbstract: boolean): ScholarPaper | null {
  if (!raw.paperId || !raw.title) return null;
  const names = (raw.authors ?? []).map((a) => a.name ?? "").filter(Boolean);
  const doi = raw.externalIds?.DOI;
  const arxiv = raw.externalIds?.ArXiv;
  const abstract = raw.abstract || raw.tldr?.text || "";
  return {
    id: raw.paperId,
    title: raw.title,
    authors:
      names.length > MAX_AUTHORS ? [...names.slice(0, MAX_AUTHORS), "et al."] : names,
    year: raw.year ? String(raw.year) : "n.d.",
    venue: raw.venue ?? "",
    citations: raw.citationCount ?? null,
    // Prefer a link a visitor can open without an account.
    url: doi
      ? `https://doi.org/${doi}`
      : arxiv
        ? `https://arxiv.org/abs/${arxiv}`
        : raw.url || `https://www.semanticscholar.org/paper/${raw.paperId}`,
    ...(withAbstract && {
      abstract: abstract ? truncate(abstract, MAX_ABSTRACT_CHARS) : "(no abstract available)",
    }),
  };
}

const throttle = new Throttle(1100, 4000);
const cache = new TtlCache<unknown>(60 * 60 * 1000, 200);

export class ScholarRateLimitError extends Error {}

async function get(path: string, params: Record<string, string>) {
  const url = `${API_URL}${path}?${new URLSearchParams(params)}`;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  // One retry on 429: the keyless pool is shared and often briefly full.
  for (let attempt = 0; ; attempt++) {
    await throttle.acquire();
    const res = await fetch(url, {
      headers: {
        "User-Agent": "thesis-chat-rag (https://chat.goldhoorn.net)",
        ...(API_KEY && { "x-api-key": API_KEY }),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw new ScholarRateLimitError("Semantic Scholar rate limit");
    }
    // 404: no paper matches the title or id.
    if (res.status === 404) {
      cache.set(url, null);
      return null;
    }
    if (!res.ok) throw new Error(`Semantic Scholar HTTP ${res.status}`);
    const body = await res.json();
    cache.set(url, body);
    return body;
  }
}

export async function findPaper(by: { title?: string; id?: string }) {
  if (by.id) {
    const raw = (await get(`/paper/${encodeURI(by.id)}`, {
      fields: PAPER_FIELDS,
    })) as RawPaper | null;
    return raw ? toPaper(raw, true) : null;
  }
  const body = (await get("/paper/search/match", {
    query: by.title!,
    fields: PAPER_FIELDS,
  })) as { data?: RawPaper[] } | null;
  const raw = body?.data?.[0];
  return raw ? toPaper(raw, true) : null;
}

export async function paperLinks(id: string, direction: "references" | "citations") {
  const body = (await get(
    `/paper/${encodeURI(id)}/${direction}`,
    { fields: LINK_FIELDS, limit: String(LINK_RESULTS) }
  )) as { data?: { citedPaper?: RawPaper; citingPaper?: RawPaper }[] | null } | null;
  if (!body) return null;
  const papers = (body.data ?? [])
    .map((row) => toPaper((direction === "references" ? row.citedPaper : row.citingPaper) ?? {}, false))
    .filter((p): p is ScholarPaper => p !== null);
  // Publishers sometimes hide reference lists (data: null); say so instead of "none".
  return { papers, hidden: body.data === null };
}

export async function searchPapers(query: string) {
  const body = (await get("/paper/search", {
    query,
    fields: PAPER_FIELDS,
    limit: String(SEARCH_RESULTS),
  })) as { data?: RawPaper[] } | null;
  return (body?.data ?? [])
    .map((raw) => toPaper(raw, true))
    .filter((p): p is ScholarPaper => p !== null);
}
