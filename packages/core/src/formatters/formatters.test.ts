import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAuditReport } from "../report-schema.js";
import { emptyReport, sampleReport, suggestedReport } from "../testing/sample-report.js";
import {
  formatHtml,
  formatJson,
  formatMarkdown,
  formatReport,
  formatSarif,
  formatText,
} from "./index.js";

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
      "| Critical | Images must have alternative text | WCAG 1.1.1 (A) | 3 |",
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
    // One row per rule, even though image-alt spans two groups.
    expect(anchors).toHaveLength(3);
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

describe("reports with AI suggestions", () => {
  const report = suggestedReport();

  it("round-trips through JSON, and reports written before --fix existed still load", () => {
    expect(parseAuditReport(JSON.parse(formatJson(report)))).toEqual(report);

    const legacy = JSON.parse(formatJson(sampleReport()));
    delete legacy.ai;
    for (const group of legacy.groups) delete group.suggestion;
    expect(parseAuditReport(legacy)).toEqual(sampleReport());
  });

  describe.each([
    ["markdown", formatMarkdown(report)],
    ["html", formatHtml(report)],
    ["text", formatText(report)],
  ])("%s", (_format, output) => {
    it("discloses that the content is AI-written and what verified means", () => {
      expect(output).toContain("written by an AI model (test-model via test-provider)");
      expect(output).toMatch(/does not mean the fix is the best one/);
    });

    it("labels each patch with its verification status", () => {
      expect(output).toContain("Verified");
      expect(output).toContain("Not verified");
      expect(output).toContain("Could not be verified automatically");
      expect(output).toContain("still reports");
    });

    it("says when a patch only shows the element itself", () => {
      expect(output).toContain("its children stay as they are");
    });

    it("never calls the page compliant or conformant", () => {
      expect(output).not.toMatch(/\b(is|are|now) (compliant|conformant|accessible)\b/i);
    });
  });

  it("escapes model output in HTML just like page content", () => {
    const html = formatHtml(report);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(4)&lt;/script&gt;");
  });

  it("keeps model output from breaking Markdown structure", () => {
    const markdown = formatMarkdown(report);
    expect(markdown.replace(/```html\n[\s\S]*?\n\s*```/g, "")).not.toContain("<script>");
    expect(markdown).toMatch(/explanation with a \\\| pipe/);
  });

  it("adds the explanation to SARIF messages, marked as AI-written", () => {
    const messages = z
      .object({
        runs: z.array(
          z.object({ results: z.array(z.object({ message: z.object({ text: z.string() }) })) }),
        ),
      })
      .parse(JSON.parse(formatSarif(report)))
      .runs[0]?.results.map((result) => result.message.text);
    expect(messages?.[0]).toMatch(/AI explanation: The image has no text alternative\.$/);
    expect(messages?.at(-1)).not.toContain("AI explanation");
  });
});

describe("formatText", () => {
  it("is a compact summary without markup", () => {
    const text = formatText(sampleReport());
    expect(text).toMatch(
      /^Allytic accessibility report\nTarget: {2}https:\/\/example\.test\/shop \(Shop\)/,
    );
    expect(text).toContain("CRITICAL  Images must have alternative text");
    expect(text).toContain("  image-alt · WCAG 1.1.1 (A) · 2 elements");
    expect(text).toContain("Needs manual review (1 check, not counted as issues):");
    expect(text).toMatch(/Note: Automated testing only detects part/);
    expect(text).not.toMatch(/[#*|`]{2}/);
  });

  it("shows patches as removed and added lines", () => {
    const text = formatText(suggestedReport());
    expect(text).toContain("  Fix [Verified] for img:nth-child(1)");
    expect(text).toContain('    - <img src="a.png" width="10">');
    expect(text).toContain('    + <img src="a.png" width="10" alt="Coffee beans">');
    expect(text).toContain(
      "AI: 1 verified patch out of 3 suggestions (4 model calls, 1 cache hit).",
    );
  });

  it("strips terminal control sequences coming from the page", () => {
    const report = sampleReport();
    report.target.title = "Shop\u001b[2J\u001b[31m";
    const first = report.groups[0]?.findings[0];
    if (first) first.selector = "img\u0007\u001b]0;pwned\u0007";
    const text = formatText(report);
    expect(text.includes("\u001b")).toBe(false);
    expect(text.includes("\u0007")).toBe(false);
    expect(text).toContain("(Shop[2J[31m)");
  });
});
