import { describe, expect, it } from "vitest";
import { PAPER_ID_PATTERN, toPaper } from "./scholar";

describe("PAPER_ID_PATTERN", () => {
  it.each([
    "DOI:10.1007/s10514-017-9681-6",
    "ARXIV:2303.09172",
    "f115acbd94451f58a5bc5062c1d7e6707e5be1f0",
    "CorpusId:7423067",
  ])("accepts %s", (id) => expect(PAPER_ID_PATTERN.test(id)).toBe(true));
  it.each(["", "../../x", "DOI:10.1/x?y=1", "DOI:a b", "f115acbd", "paper/123"])(
    "rejects %j",
    (id) => expect(PAPER_ID_PATTERN.test(id)).toBe(false)
  );
});

describe("toPaper", () => {
  const raw = {
    paperId: "abc",
    title: "Monte-Carlo Planning in Large POMDPs",
    year: 2010,
    venue: "NeurIPS",
    authors: [{ name: "David Silver" }, { name: "J. Veness" }],
    citationCount: 1500,
    externalIds: { DBLP: "conf/nips/SilverV10" },
    url: "https://www.semanticscholar.org/paper/abc",
    abstract: null,
    tldr: { text: "Short summary." },
  };
  it("falls back to the TLDR and the Semantic Scholar URL", () => {
    expect(toPaper(raw, true)).toEqual({
      id: "abc",
      title: "Monte-Carlo Planning in Large POMDPs",
      authors: ["David Silver", "J. Veness"],
      year: "2010",
      venue: "NeurIPS",
      citations: 1500,
      url: "https://www.semanticscholar.org/paper/abc",
      abstract: "Short summary.",
    });
  });
  it("prefers DOI, then arXiv links, and omits abstracts for link lists", () => {
    expect(toPaper({ ...raw, externalIds: { DOI: "10.1/x", ArXiv: "1" } }, false)).toMatchObject({
      url: "https://doi.org/10.1/x",
    });
    expect(toPaper({ ...raw, externalIds: { ArXiv: "2303.09172" } }, false)).not.toHaveProperty("abstract");
    expect(toPaper({ ...raw, externalIds: { ArXiv: "2303.09172" } }, false)?.url).toBe(
      "https://arxiv.org/abs/2303.09172"
    );
  });
  it("drops entries without id or title, and caps authors", () => {
    expect(toPaper({ title: "x" }, true)).toBeNull();
    const many = toPaper({ ...raw, authors: "ABCDEFG".split("").map((name) => ({ name })) }, false);
    expect(many?.authors).toEqual(["A", "B", "C", "D", "E", "et al."]);
  });
});
