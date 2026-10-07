import type { AuditReport } from "../report-schema.js";
import { formatHtml } from "./html.js";
import { formatJson } from "./json.js";
import { formatMarkdown } from "./markdown.js";
import { formatSarif, type SarifOptions } from "./sarif.js";
import type { ReportFormat } from "./shared.js";
import { formatText } from "./text.js";

export interface FormatOptions {
  sarif?: SarifOptions;
}

export function formatReport(
  report: AuditReport,
  format: ReportFormat,
  options: FormatOptions = {},
): string {
  switch (format) {
    case "text":
      return formatText(report);
    case "json":
      return formatJson(report);
    case "markdown":
      return formatMarkdown(report);
    case "html":
      return formatHtml(report);
    case "sarif":
      return formatSarif(report, options.sarif);
  }
}

export {
  FILE_EXTENSIONS,
  isReportFormat,
  REPORT_FORMATS,
  type ReportFormat,
  summaryLine,
} from "./shared.js";
export { formatHtml, formatJson, formatMarkdown, formatSarif, formatText, type SarifOptions };
