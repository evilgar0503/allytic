import { parseAxeResults } from "./axe-results.js";
import { groupFindings } from "./group.js";
import { type Impact, meetsImpactThreshold } from "./impact.js";
import { normalizeRuleResults } from "./normalize.js";
import {
  type AuditReport,
  type AuditTarget,
  DISCLAIMER,
  type FindingGroup,
  REPORT_SCHEMA_VERSION,
  type ReportSummary,
  STANDARD,
} from "./report-schema.js";

export interface BuildReportInput {
  /** Raw output of `axe.run()`; validated here. */
  axeResults: unknown;
  tool: { name: string; version: string };
  target: { kind: AuditTarget["kind"]; input: string; title: string | null };
  /** Injected so that `core` stays deterministic and testable. */
  now: Date;
}

function countFindings(groups: readonly FindingGroup[]): number {
  return groups.reduce((total, group) => total + group.findings.length, 0);
}

function summarize(groups: readonly FindingGroup[], needsReview: readonly FindingGroup[]) {
  const byImpact: ReportSummary["byImpact"] = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const group of groups) {
    for (const finding of group.findings) byImpact[finding.impact]++;
  }
  return {
    findings: countFindings(groups),
    groups: groups.length,
    rules: new Set(groups.map((group) => group.rule.id)).size,
    needsReview: countFindings(needsReview),
    byImpact,
  } satisfies ReportSummary;
}

/** Builds an Allytic report from raw axe-core output. */
export function buildReport(input: BuildReportInput): AuditReport {
  const axe = parseAxeResults(input.axeResults);
  const groups = groupFindings(normalizeRuleResults(axe.violations));
  const needsReview = groupFindings(normalizeRuleResults(axe.incomplete));

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: input.tool,
    engine: axe.testEngine,
    target: { ...input.target, url: axe.url },
    generatedAt: input.now.toISOString(),
    standard: STANDARD,
    summary: summarize(groups, needsReview),
    groups,
    needsReview,
    disclaimer: DISCLAIMER,
  };
}

/** True when the report has at least one confirmed finding at or above `threshold`. */
export function hasFindingsAtOrAbove(report: AuditReport, threshold: Impact): boolean {
  return report.groups.some((group) =>
    group.findings.some((finding) => meetsImpactThreshold(finding.impact, threshold)),
  );
}
