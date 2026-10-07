import { describe, expect, it } from "vitest";
import { parseAxeResults } from "./axe-results.js";
import { MAX_HTML_LENGTH, normalizeRuleResults } from "./normalize.js";
import { sampleAxeResults } from "./testing/sample-axe-results.js";

function normalizeSample() {
  const axe = parseAxeResults(sampleAxeResults());
  return {
    violations: normalizeRuleResults(axe.violations),
    incomplete: normalizeRuleResults(axe.incomplete),
  };
}

describe("normalizeRuleResults", () => {
  it("drops rules without failing nodes", () => {
    const { violations } = normalizeSample();
    expect(violations.map((entry) => entry.rule.id)).toEqual([
      "color-contrast",
      "image-alt",
      "heading-order",
    ]);
  });

  it("maps rule metadata to WCAG", () => {
    const [contrast, , headings] = normalizeSample().violations;
    expect(contrast?.rule).toMatchObject({
      wcagCriteria: ["1.4.3"],
      wcagLevel: "AA",
      bestPractice: false,
    });
    expect(headings?.rule).toMatchObject({
      wcagCriteria: [],
      wcagLevel: null,
      bestPractice: true,
    });
  });

  it("flattens selectors that cross frames and shadow roots", () => {
    const imageAlt = normalizeSample().violations[1];
    expect(imageAlt?.findings[2]?.selector).toBe("iframe#shop > x-card >>> img.hero");
  });

  it("normalizes missing failure summaries to null and trims the others", () => {
    const findings = normalizeSample().violations[1]?.findings ?? [];
    expect(findings[0]?.failureSummary).toMatch(/^Fix any of the following/);
    expect(findings[1]?.failureSummary).toBeNull();
    expect(findings[2]?.failureSummary).toBeNull();
  });

  it("falls back to moderate when axe gives no impact", () => {
    expect(normalizeSample().incomplete[0]?.findings[0]?.impact).toBe("moderate");
  });

  it("truncates long snippets and says so", () => {
    const input = sampleAxeResults();
    const long = `<div>${"x".repeat(MAX_HTML_LENGTH * 2)}</div>`;
    const first = input.violations[0];
    if (first?.nodes[0]) first.nodes[0].html = long;
    const finding = normalizeRuleResults(parseAxeResults(input).violations)[0]?.findings[0];
    expect(finding?.html).toHaveLength(MAX_HTML_LENGTH);
    expect(finding?.htmlTruncated).toBe(true);
  });

  it("gives findings ids that are stable across runs and unique within one", () => {
    const first = normalizeSample().violations.flatMap((entry) => entry.findings);
    const second = normalizeSample().violations.flatMap((entry) => entry.findings);
    expect(first.map((finding) => finding.id)).toEqual(second.map((finding) => finding.id));
    expect(new Set(first.map((finding) => finding.id)).size).toBe(first.length);
  });
});
