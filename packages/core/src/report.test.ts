import { describe, expect, it } from "vitest";
import { InvalidAxeResultsError, InvalidReportError } from "./errors.js";
import { buildReport, hasFindingsAtOrAbove } from "./report.js";
import { auditReportSchema, parseAuditReport } from "./report-schema.js";
import { sampleAxeResults } from "./testing/sample-axe-results.js";
import { sampleReport } from "./testing/sample-report.js";

describe("buildReport", () => {
  it("summarizes confirmed findings and keeps needs-review apart", () => {
    const report = sampleReport();
    expect(report.summary).toEqual({
      findings: 5,
      groups: 4,
      rules: 3,
      needsReview: 1,
      byImpact: { critical: 3, serious: 1, moderate: 1, minor: 0 },
    });
    expect(report.needsReview.map((group) => group.rule.id)).toEqual(["duplicate-id-aria"]);
  });

  it("records the engine, the final URL and the injected date", () => {
    const report = sampleReport();
    expect(report.engine).toEqual({ name: "axe-core", version: "4.13.0" });
    expect(report.target).toEqual({
      kind: "url",
      input: "example.test/shop",
      url: "https://example.test/shop",
      title: "Shop",
    });
    expect(report.generatedAt).toBe("2026-10-07T12:00:00.000Z");
  });

  it("always carries the disclaimer and never claims conformance", () => {
    const report = sampleReport();
    expect(report.disclaimer).toMatch(/not a statement of conformance/);
  });

  it("produces a report that satisfies its own schema", () => {
    expect(auditReportSchema.safeParse(sampleReport()).success).toBe(true);
  });

  it("rejects input that is not axe output with a typed error", () => {
    const build = (axeResults: unknown) =>
      buildReport({
        axeResults,
        tool: { name: "Allytic", version: "0.0.0" },
        target: { kind: "url", input: "x", title: null },
        now: new Date(0),
      });
    expect(() => build({ violations: "nope" })).toThrow(InvalidAxeResultsError);
    expect(() => build(null)).toThrow(InvalidAxeResultsError);
  });

  it("accepts axe output without an incomplete list", () => {
    const { incomplete: _incomplete, ...withoutIncomplete } = sampleAxeResults();
    const report = buildReport({
      axeResults: withoutIncomplete,
      tool: { name: "Allytic", version: "0.0.0" },
      target: { kind: "url", input: "x", title: null },
      now: new Date(0),
    });
    expect(report.needsReview).toEqual([]);
  });
});

describe("hasFindingsAtOrAbove", () => {
  it("compares against the most severe confirmed finding", () => {
    const report = sampleReport();
    expect(hasFindingsAtOrAbove(report, "critical")).toBe(true);
    expect(hasFindingsAtOrAbove(report, "minor")).toBe(true);
  });

  it("ignores checks that only need review", () => {
    const report = { ...sampleReport(), groups: [] };
    expect(hasFindingsAtOrAbove(report, "minor")).toBe(false);
  });
});

describe("parseAuditReport", () => {
  it("round-trips a report through JSON", () => {
    const report = sampleReport();
    expect(parseAuditReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("rejects other schema versions and malformed input with a typed error", () => {
    expect(() => parseAuditReport({ ...sampleReport(), schemaVersion: 2 })).toThrow(
      InvalidReportError,
    );
    expect(() => parseAuditReport("<html>")).toThrow(InvalidReportError);
  });
});
