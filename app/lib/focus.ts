// Document focus (?doc=<slug>): pure helpers shared by the routes and the page.
// No database or Node imports, so the client bundle and the tests can use them.

// Slug = the ingested filename (metadata.source) without its extension.
export const SLUG_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

export function slugOf(source: string) {
  return source.replace(/\.[^.]+$/, "");
}

export type DocInfo = {
  slug: string;
  title: string;
  year: string;
  type: string;
  url: string;
};

// Same fallback the citations have always used: the BibTeX url, else the site.
export function docUrl(meta: { url?: string; source?: string }) {
  return (
    meta.url || `https://alex.goldhoorn.net/publications/dl/${meta.source}`
  );
}

type Row = { id: string | number; metadata: { source?: string } | null };

// Focused chunks first, then general ones that come from another source and
// are not already in the focused set.
export function mergeFocused<T extends Row>(
  focused: T[],
  general: T[],
  focusedSource: string
): T[] {
  const seen = new Set(focused.map((row) => String(row.id)));
  return [
    ...focused,
    ...general.filter(
      (row) =>
        row.metadata?.source !== focusedSource && !seen.has(String(row.id))
    ),
  ];
}

export function focusParagraph(doc: DocInfo, matched: boolean) {
  const name = `"${doc.title} (${doc.year})"`;
  return matched
    ? `The visitor opened this chat from ${name} and is reading it. Treat questions as being about that document unless they say otherwise. When you draw on a different source, say so and cite it.`
    : `The visitor opened this chat from ${name}, but no passage of it matched this question. Answer from the sources below and say that the answer does not come from that document.`;
}
