import { describe, expect, it } from "vitest";
import { cleanQuery, parseArxivFeed } from "./arxiv";

const FEED = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/x</id>
  <title>arXiv Query: search_query=all:POMCP</title>
  <entry>
    <id>http://arxiv.org/abs/2303.09172v1</id>
    <title>Learning Logic Specifications for
      Soft Policy Guidance in POMCP</title>
    <published>2023-03-16T09:37:10Z</published>
    <summary>Partially Observable Monte Carlo Planning (POMCP) is an
      efficient solver &amp; more &lt;b&gt;.</summary>
    <author><name>Giulio Mazzi</name></author>
    <author>
      <name>Daniele Meli</name>
    </author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1006.1234</id>
    <title>Many authors</title>
    <published>2010-06-01T00:00:00Z</published>
    <summary>${"x".repeat(1500)}</summary>
    ${["A", "B", "C", "D", "E", "F"].map((n) => `<author><name>${n}</name></author>`).join("")}
  </entry>
</feed>`;

describe("parseArxivFeed", () => {
  const papers = parseArxivFeed(FEED);
  it("parses entries, not the feed header", () => {
    expect(papers.map((p) => p.id)).toEqual(["2303.09172v1", "1006.1234"]);
  });
  it("normalises whitespace, decodes entities and builds the abs URL", () => {
    expect(papers[0]).toEqual({
      id: "2303.09172v1",
      title: "Learning Logic Specifications for Soft Policy Guidance in POMCP",
      authors: ["Giulio Mazzi", "Daniele Meli"],
      year: "2023",
      abstract:
        "Partially Observable Monte Carlo Planning (POMCP) is an efficient solver & more <b>.",
      url: "https://arxiv.org/abs/2303.09172v1",
    });
  });
  it("caps authors and abstract length", () => {
    expect(papers[1].authors).toEqual(["A", "B", "C", "D", "E", "et al."]);
    expect(papers[1].abstract.length).toBe(1201);
  });
  it("returns nothing for an empty or error feed", () => {
    expect(parseArxivFeed("<feed></feed>")).toEqual([]);
  });
});

describe("cleanQuery", () => {
  it("keeps arXiv query syntax", () => {
    expect(cleanQuery('ti:"POMCP" AND au:Silver')).toBe('ti:"POMCP" AND au:Silver');
  });
  it("drops other characters and caps length", () => {
    expect(cleanQuery("a&b=c\n<script>")).toBe("a b c script");
    expect(cleanQuery("x".repeat(300))).toHaveLength(200);
  });
});
