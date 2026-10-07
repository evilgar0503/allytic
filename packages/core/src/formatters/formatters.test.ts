import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAuditReport } from "../report-schema.js";
import { emptyReport, sampleReport } from "../testing/sample-report.js";
import { formatHtml, formatJson, formatMarkdown, formatReport, formatSarif } from "./index.js";

const HOSTILE_SNIPPET =
  '<img src="x" class="hero" onerror="alert(1)" title="a|b `c` </code><script>alert(2)</script>">';

describe("formatJson", () => {
  it("emits a report that can be loaded back", () => {
    const report = sampleReport();
    expect(parseAuditReport(JSON.parse(formatJson(report)))).toEqual(report);
  });
});

describe("formatMarkdown", () => {
  const markdown = formatMarkdown(sampleReport());

  it("starts with the disclaimer before any result", () => {
    expect(markdown.indexOf("not a statement of conformance")).toBeGreaterThan(0);
    expect(markdown.indexOf("not a statement of conformance")).toBeLessThan(
      markdown.indexOf("## Summary"),
    );
  });

  it("lists every group in the summary table", () => {
    expect(markdown).toContain(
      "| Critical | Images must have alternative text | WCAG 1.1.1 (A) | 2 |",
    );
    expect(markdown).toContain(
      "| Moderate | Heading levels should only increase by one | Best practice | 1 |",
    );
  });

  it("keeps audited markup inside code blocks", () => {
    // The snippet is reproduced verbatim, but only between fences that it cannot close.
    const fenced = markdown
      .split("```html\n")
      .slice(1)
      .map((part) => part.split("\n```")[0]);
    expect(fenced.some((block) => block?.includes(HOSTILE_SNIPPET))).toBe(true);
    const outsideFences = markdown.replace(/```html\n[\s\S]*?\n\s*```/g, "");
    expect(outsideFences).not.toContain("<script>");
  });

  it("mentions checks that need manual review without counting them", () => {
    expect(markdown).toContain("## Needs manual review");
    expect(markdown).toContain("5 issues in 3 rules");
  });

  it("says so when nothing was found, without claiming conformance", () => {
    const empty = formatMarkdown(emptyReport());
    expect(empty).toContain("No automatically detectable issues found");
    expect(empty).not.toMatch(/\b(compliant|conforms|passes WCAG)\b/i);
    expect(empty).not.toContain("## Issues");
  });
});

describe("formatHtml", () => {
  const html = formatHtml(sampleReport());

  it("is a complete document with a language and a title", () => {
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(html).toContain("<title>Allytic accessibility report — Shop</title>");
  });

  it("escapes markup that comes from the audited page", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("loads nothing from the network and runs no script", () => {
    expect(html).not.toMatch(/<script|<link|<img|<iframe|\ssrc="|@import|url\(/i);
  });

  it("links each summary row to its section", () => {
    const anchors = [...html.matchAll(/href="#(group-[0-9a-f]+)"/g)].map((match) => match[1]);
    expect(anchors).toHaveLength(4);
    for (const anchor of anchors) expect(html).toContain(`id="${anchor}"`);
  });

  it("does not link to non-http targets", () => {
    const report = sampleReport();
    report.target.url = "javascript:alert(1)";
    expect(formatHtml(report)).not.toContain('href="javascript:');
  });

  it("omits the issue sections when there is nothing to show", () => {
    const empty = formatHtml(emptyReport());
    expect(empty).not.toContain("<table>");
    expect(empty).toContain("Not a conformance statement.");
  });
});

describe("formatSarif", () => {
  const sarifSchema = z.object({
    version: z.literal("2.1.0"),
    runs: z
      .array(
        z.object({
          tool: z.object({
            driver: z.object({
              name: z.string(),
              version: z.string(),
              rules: z.array(z.object({ id: z.string(), helpUri: z.string() })),
            }),
          }),
          results: z.array(
            z.object({
              ruleId: z.string(),
              ruleIndex: z.number(),
              level: z.enum(["error", "warning", "note"]),
              message: z.object({ text: z.string() }),
              locations: z.array(
                z.object({
                  physicalLocation: z.object({
                    artifactLocation: z.object({ uri: z.string() }),
                    region: z.object({ startLine: z.number() }),
                  }),
                }),
              ),
              partialFingerprints: z.record(z.string(), z.string()),
            }),
          ),
        }),
      )
      .length(1),
  });

  function parse(sarif: string) {
    const run = sarifSchema.parse(JSON.parse(sarif)).runs[0];
    if (!run) throw new Error("no run");
    return run;
  }

  it("has one rule per axe rule and one result per failing element", () => {
    const run = parse(formatSarif(sampleReport()));
    expect(run.tool.driver.rules.map((rule) => rule.id)).toEqual([
      "image-alt",
      "color-contrast",
      "heading-order",
    ]);
    expect(run.results).toHaveLength(5);
  });

  it("points every result at its rule and maps impact to a level", () => {
    const run = parse(formatSarif(sampleReport()));
    for (const result of run.results) {
      expect(run.tool.driver.rules[result.ruleIndex]?.id).toBe(result.ruleId);
    }
    expect(run.results.map((result) => result.level)).toEqual([
      "error",
      "error",
      "error",
      "error",
      "warning",
    ]);
  });

  it("uses the audited URL as location unless a repository path is given", () => {
    const byDefault = parse(formatSarif(sampleReport()));
    expect(byDefault.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      "https://example.test/shop",
    );
    const withPath = parse(formatSarif(sampleReport(), { artifactUri: "dist/index.html" }));
    expect(withPath.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      "dist/index.html",
    );
  });

  it("gives every result a distinct fingerprint", () => {
    const run = parse(formatSarif(sampleReport()));
    const fingerprints = run.results.map(
      (result) => result.partialFingerprints["allyticFinding/v1"],
    );
    expect(new Set(fingerprints).size).toBe(run.results.length);
  });

  it("is valid with zero results", () => {
    expect(parse(formatSarif(emptyReport())).results).toEqual([]);
  });
});

describe("formatReport", () => {
  it("dispatches on the format", () => {
    const report = sampleReport();
    expect(formatReport(report, "json")).toBe(formatJson(report));
    expect(formatReport(report, "markdown")).toBe(formatMarkdown(report));
    expect(formatReport(report, "html")).toBe(formatHtml(report));
    expect(formatReport(report, "sarif", { sarif: { artifactUri: "a.html" } })).toBe(
      formatSarif(report, { artifactUri: "a.html" }),
    );
  });
});
