import type { AuditReport } from "../report-schema.js";

export function formatJson(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
