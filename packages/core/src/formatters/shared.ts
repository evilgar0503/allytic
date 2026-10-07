import { IMPACT_LEVELS, type Impact } from "../impact.js";
import type { AuditReport, FindingGroup, Patch, Rule } from "../report-schema.js";

export const REPORT_FORMATS = ["text", "json", "markdown", "html", "sarif"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export function isReportFormat(value: unknown): value is ReportFormat {
  // Widening cast only: Array.includes on a tuple of literals rejects a plain string.
  return typeof value === "string" && (REPORT_FORMATS as readonly string[]).includes(value);
}

export const FILE_EXTENSIONS: Record<ReportFormat, string> = {
  text: "txt",
  json: "json",
  markdown: "md",
  html: "html",
  sarif: "sarif",
};

/** "WCAG 1.4.3 (AA)", "Best practice", or "Not mapped to WCAG". */
export function wcagLabel(rule: Rule): string {
  if (rule.wcagCriteria.length > 0) {
    const level = rule.wcagLevel ? ` (${rule.wcagLevel})` : "";
    return `WCAG ${rule.wcagCriteria.join(", ")}${level}`;
  }
  return rule.bestPractice ? "Best practice" : "Not mapped to WCAG";
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One-line plain-text summary, used by the CLI on stderr and by the reports. */
export function summaryLine(report: AuditReport): string {
  const { summary } = report;
  if (summary.findings === 0) {
    return `No automatically detectable issues found on ${report.target.url}`;
  }
  const impacts = (["critical", "serious", "moderate", "minor"] as const)
    .filter((impact) => summary.byImpact[impact] > 0)
    .map((impact) => `${summary.byImpact[impact]} ${impact}`)
    .join(", ");
  return `${pluralize(summary.findings, "issue")} in ${pluralize(summary.rules, "rule")} (${impacts}) on ${report.target.url}`;
}

export function instancesLabel(group: FindingGroup): string {
  return pluralize(group.findings.length, "element");
}

export interface RuleRow {
  rule: Rule;
  impact: Impact;
  elements: number;
  /** Id of the first (most severe) group of the rule, for linking. */
  firstGroupId: string;
}

/**
 * One row per rule for summary tables. A rule can span several groups (one per markup
 * pattern); listing them separately in a summary only looks like a duplicate.
 */
export function ruleRows(groups: readonly FindingGroup[]): RuleRow[] {
  const rows = new Map<string, RuleRow>();
  for (const group of groups) {
    const row = rows.get(group.rule.id);
    if (row) {
      row.elements += group.findings.length;
      if (IMPACT_LEVELS.indexOf(group.impact) > IMPACT_LEVELS.indexOf(row.impact)) {
        row.impact = group.impact;
      }
    } else {
      rows.set(group.rule.id, {
        rule: group.rule,
        impact: group.impact,
        elements: group.findings.length,
        firstGroupId: group.id,
      });
    }
  }
  return [...rows.values()];
}

/** Short status and a full sentence for a patch. Wording never suggests more than was checked. */
export function verificationLabel(patch: Patch): { status: string; sentence: string } {
  switch (patch.verification.status) {
    case "verified":
      return {
        status: "Verified",
        sentence:
          "With this patch applied, axe-core no longer reports the rule on this element and no rule reports more elements than before.",
      };
    case "failed":
      return {
        status: "Not verified",
        sentence:
          patch.verification.detail ?? "The patch did not pass the check when it was applied.",
      };
    case "not-verifiable":
      return {
        status: "Could not be verified automatically",
        sentence: patch.verification.detail ?? "The patch could not be tried on the page.",
      };
  }
}

/** Disclosure shown wherever AI-written text appears. */
export function aiNotice(report: AuditReport): string | null {
  if (!report.ai) return null;
  const stopped = report.ai.stoppedEarly
    ? ` Some issues have no suggestion: ${report.ai.stoppedEarly}`
    : "";
  return (
    `Explanations and patches were written by an AI model (${report.ai.model} via ${report.ai.provider}) and can be wrong. ` +
    `"Verified" means the patch was applied and axe-core was run again; it does not mean the fix is the best one, ` +
    `and generated text such as image descriptions must be checked by a person.${stopped}`
  );
}

export function patchScopeNote(patch: Patch): string | null {
  return patch.childrenOmitted
    ? "Only the element itself is shown; its children stay as they are."
    : null;
}
