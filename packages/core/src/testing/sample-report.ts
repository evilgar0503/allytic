import { buildReport } from "../report.js";
import type { AuditReport } from "../report-schema.js";
import { sampleAxeResults } from "./sample-axe-results.js";

export function sampleReport(): AuditReport {
  return buildReport({
    axeResults: sampleAxeResults(),
    tool: { name: "Allytic", version: "1.2.3" },
    target: { kind: "url", input: "example.test/shop", title: "Shop" },
    now: new Date("2026-10-07T12:00:00.000Z"),
  });
}

export function emptyReport(): AuditReport {
  return buildReport({
    axeResults: { ...sampleAxeResults(), violations: [], incomplete: [] },
    tool: { name: "Allytic", version: "1.2.3" },
    target: { kind: "url", input: "example.test/shop", title: null },
    now: new Date("2026-10-07T12:00:00.000Z"),
  });
}
