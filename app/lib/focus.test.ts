import { describe, expect, it } from "vitest";
import { docUrl, focusParagraph, mergeFocused, SLUG_PATTERN, slugOf } from "./focus";

describe("slugOf", () => {
  it("strips only the last extension", () => {
    expect(slugOf("Goldhoorn2017_PhD_thesis.pdf")).toBe("Goldhoorn2017_PhD_thesis");
    expect(slugOf("Goldhoorn2026-Article-LLM-Coding-Patterns.txt")).toBe(
      "Goldhoorn2026-Article-LLM-Coding-Patterns"
    );
    expect(slugOf("a.b.pdf")).toBe("a.b");
    expect(slugOf("noext")).toBe("noext");
  });
});

describe("SLUG_PATTERN", () => {
  it.each(["Goldhoorn2017_PhD_thesis", "Nope2020", "a.b-c_d"])("accepts %s", (s) =>
    expect(SLUG_PATTERN.test(s)).toBe(true)
  );
  it.each(["", "../etc", "a/b", "a b", "x'; drop table documents;--", "é", "a".repeat(121)])(
    "rejects %j",
    (s) => expect(SLUG_PATTERN.test(s)).toBe(false)
  );
});

describe("mergeFocused", () => {
  const row = (id: number, source: string) => ({ id: String(id), metadata: { source } });
  it("puts focused rows first and drops duplicates and focused-source rows from general", () => {
    const focused = [row(1, "A.pdf"), row(2, "A.pdf")];
    const general = [row(2, "A.pdf"), row(3, "A.pdf"), row(4, "B.pdf"), row(5, "C.txt")];
    expect(mergeFocused(focused, general, "A.pdf").map((r) => r.id)).toEqual(["1", "2", "4", "5"]);
  });
  it("keeps general rows when nothing in the focused document matched", () => {
    expect(mergeFocused([], [row(4, "B.pdf")], "A.pdf").map((r) => r.id)).toEqual(["4"]);
  });
});

describe("docUrl", () => {
  it("prefers the BibTeX url, else the site's publications/dl", () => {
    expect(docUrl({ url: "https://x/y", source: "a.pdf" })).toBe("https://x/y");
    expect(docUrl({ source: "a.pdf" })).toBe("https://alex.goldhoorn.net/publications/dl/a.pdf");
  });
});

describe("focusParagraph", () => {
  const doc = { slug: "s", title: "T", year: "2017", type: "article", url: "u" };
  it("switches wording when the focused document had no match", () => {
    expect(focusParagraph(doc, true)).toContain('opened this chat from "T (2017)" and is reading it');
    expect(focusParagraph(doc, false)).toContain("no passage of it matched");
  });
});
