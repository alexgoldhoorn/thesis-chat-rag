// arXiv search for the chat's arxiv_search tool. Abstracts only, never PDFs.
// arXiv asks API clients for at most one request every three seconds, so calls
// are spaced globally and identical queries are served from a short cache.
import { Throttle, TtlCache, truncate } from "./external";

const API_URL = "https://export.arxiv.org/api/query";
const MAX_RESULTS = 5;
const MAX_ABSTRACT_CHARS = 1200;
const MAX_AUTHORS = 5;
const TIMEOUT_MS = 8000;

export type ArxivPaper = {
  id: string;
  title: string;
  authors: string[];
  year: string;
  abstract: string;
  url: string;
};

// The model writes arXiv query syntax (ti:, au:, abs:, AND, OR, quotes);
// anything outside that character set is dropped.
export function cleanQuery(query: string) {
  return query
    .replace(/[^A-Za-z0-9 :"()\-.']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function decode(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(entry: string, name: string) {
  const match = entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1]) : "";
}

export function parseArxivFeed(xml: string): ArxivPaper[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.flatMap((entry) => {
    const idUrl = tag(entry, "id");
    const id = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
    if (!id || id === idUrl) return [];
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(
      (m) => decode(m[1])
    );
    const abstract = tag(entry, "summary");
    return [
      {
        id,
        title: tag(entry, "title"),
        authors:
          authors.length > MAX_AUTHORS
            ? [...authors.slice(0, MAX_AUTHORS), "et al."]
            : authors,
        year: tag(entry, "published").slice(0, 4),
        abstract: truncate(abstract, MAX_ABSTRACT_CHARS),
        url: `https://arxiv.org/abs/${id}`,
      },
    ];
  });
}

const throttle = new Throttle(3000, 6000);
const cache = new TtlCache<ArxivPaper[]>(60 * 60 * 1000, 100);

export async function searchArxiv(query: string): Promise<ArxivPaper[]> {
  const cached = cache.get(query);
  if (cached) return cached;

  await throttle.acquire();

  const params = new URLSearchParams({
    search_query: query,
    max_results: String(MAX_RESULTS),
    sortBy: "relevance",
  });
  const res = await fetch(`${API_URL}?${params}`, {
    headers: { "User-Agent": "thesis-chat-rag (https://chat.goldhoorn.net)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
  const papers = parseArxivFeed(await res.text());

  cache.set(query, papers);
  return papers;
}
