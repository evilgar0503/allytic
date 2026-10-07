export { type AxeResults, parseAxeResults } from "./axe-results.js";
export { AllyticError, InvalidAxeResultsError, InvalidReportError } from "./errors.js";
export {
  FILE_EXTENSIONS,
  type FormatOptions,
  formatHtml,
  formatJson,
  formatMarkdown,
  formatReport,
  formatSarif,
  isReportFormat,
  REPORT_FORMATS,
  type ReportFormat,
  type SarifOptions,
  summaryLine,
} from "./formatters/index.js";
export { groupFindings, htmlPattern } from "./group.js";
export { IMPACT_LEVELS, type Impact, isImpact, meetsImpactThreshold } from "./impact.js";
export { MAX_HTML_LENGTH, normalizeRuleResults, type RuleFindings } from "./normalize.js";
export { type BuildReportInput, buildReport, hasFindingsAtOrAbove } from "./report.js";
export {
  type AuditReport,
  type AuditTarget,
  auditReportSchema,
  DISCLAIMER,
  type Finding,
  type FindingGroup,
  parseAuditReport,
  REPORT_SCHEMA_VERSION,
  type ReportSummary,
  type Rule,
  STANDARD,
} from "./report-schema.js";
export { type WcagLevel, type WcagMapping, wcagFromTags } from "./wcag.js";
