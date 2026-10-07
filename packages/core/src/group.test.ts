import { describe, expect, it } from "vitest";
import { parseAxeResults } from "./axe-results.js";
import { groupFindings, htmlPattern } from "./group.js";
import { normalizeRuleResults } from "./normalize.js";
import { sampleAxeResults } from "./testing/sample-axe-results.js";

describe("htmlPattern", () => {
  it("ignores attribute order and values", () => {
    expect(htmlPattern('<img src="a.png" width="10">')).toBe("img[src,width]");
    expect(htmlPattern('<img width="20" src="b.png">')).toBe("img[src,width]");
  });

  it("keeps the values that change what the element is", () => {
    expect(htmlPattern('<input type="text" name="q">')).toBe("input[name,type=text]");
    expect(htmlPattern('<input type="image" src="a">')).toBe("input[src,type=image]");
    expect(htmlPattern("<div role=Button tabindex=0>Go</div>")).toBe("div[role=button,tabindex]");
  });

  it("handles elements without attributes, boolean attributes and self-closing tags", () => {
    expect(htmlPattern("<h4>Fresh</h4>")).toBe("h4");
    expect(htmlPattern("<input disabled required>")).toBe("input[disabled,required]");
    expect(htmlPattern('<IMG SRC="a.png" />')).toBe("img[src]");
  });

  it("only looks at the root element", () => {
    expect(htmlPattern('<button><svg aria-hidden="true"></svg></button>')).toBe("button");
  });

  it("is not confused by markup inside attribute values", () => {
    expect(htmlPattern('<img title="a > b </code><script>" src=x>')).toBe("img[src,title]");
    expect(htmlPattern("<a title='x > y' href=#>x</a>")).toBe("a[href,title]");
  });

  it("falls back to the tag name when the snippet was cut inside the opening tag", () => {
    expect(htmlPattern('<svg viewBox="0 0 24 24" d="M12 2a10 10 0')).toBe("svg");
  });

  it("returns a constant for text that is not markup", () => {
    expect(htmlPattern("just text")).toBe("unknown");
    expect(htmlPattern("")).toBe("unknown");
  });
});

describe("groupFindings", () => {
  const groups = groupFindings(
    normalizeRuleResults(parseAxeResults(sampleAxeResults()).violations),
  );

  it("merges findings of the same rule that share a markup pattern", () => {
    const imageGroups = groups.filter((group) => group.rule.id === "image-alt");
    expect(imageGroups.map((group) => [group.pattern, group.findings.length])).toEqual([
      ["img[src,width]", 2],
      ["img[class,onerror,src,title]", 1],
    ]);
  });

  it("orders groups by impact, then by number of findings", () => {
    expect(
      groups.map((group) => `${group.impact}:${group.rule.id}:${group.findings.length}`),
    ).toEqual([
      "critical:image-alt:2",
      "critical:image-alt:1",
      "serious:color-contrast:1",
      "moderate:heading-order:1",
    ]);
  });

  it("gives every group a distinct id", () => {
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length);
  });
});
