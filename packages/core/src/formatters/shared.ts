import type { AuditReport, FindingGroup, Rule } from "../report-schema.js";

export const REPORT_FORMATS = ["json", "markdown", "html", "sarif"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export function isReportFormat(value: unknown): value is ReportFormat {
  // Widening cast only: Array.includes on a tuple of literals rejects a plain string.
  return typeof value === "string" && (REPORT_FORMATS as readonly string[]).includes(value);
}

export const FILE_EXTENSIONS: Record<ReportFormat, string> = {
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
