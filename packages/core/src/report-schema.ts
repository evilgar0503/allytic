import { z } from "zod";
import { InvalidReportError } from "./errors.js";
import { IMPACT_LEVELS } from "./impact.js";
import { WCAG_LEVELS } from "./wcag.js";

export const REPORT_SCHEMA_VERSION = 1;
export const STANDARD = "WCAG 2.2 AA";

export const DISCLAIMER =
  "Automated testing only detects part of the accessibility problems covered by WCAG. " +
  "This report is not a statement of conformance or legal compliance. " +
  "Manual review and testing with assistive technology users are still required.";

const impactSchema = z.enum(IMPACT_LEVELS);

const ruleSchema = z.object({
  id: z.string(),
  help: z.string(),
  description: z.string(),
  helpUrl: z.string(),
  tags: z.array(z.string()),
  wcagCriteria: z.array(z.string()),
  wcagLevel: z.enum(WCAG_LEVELS).nullable(),
  bestPractice: z.boolean(),
});

const findingSchema = z.object({
  /** Stable across runs as long as the rule, selector and markup do not change. */
  id: z.string(),
  ruleId: z.string(),
  impact: impactSchema,
  selector: z.string(),
  html: z.string(),
  htmlTruncated: z.boolean(),
  failureSummary: z.string().nullable(),
});

const findingGroupSchema = z.object({
  id: z.string(),
  rule: ruleSchema,
  /** Highest impact among the findings of the group. */
  impact: impactSchema,
  /** Markup shape shared by the findings, e.g. `img[height,src,width]`. */
  pattern: z.string(),
  findings: z.array(findingSchema).min(1),
});

const summarySchema = z.object({
  findings: z.number().int().nonnegative(),
  groups: z.number().int().nonnegative(),
  rules: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  byImpact: z.object({
    critical: z.number().int().nonnegative(),
    serious: z.number().int().nonnegative(),
    moderate: z.number().int().nonnegative(),
    minor: z.number().int().nonnegative(),
  }),
});

export const auditReportSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  tool: z.object({ name: z.string(), version: z.string() }),
  engine: z.object({ name: z.string(), version: z.string() }),
  target: z.object({
    kind: z.enum(["url", "file"]),
    /** What the user asked to audit (a URL or a path). */
    input: z.string(),
    /** Final URL after redirects. */
    url: z.string(),
    title: z.string().nullable(),
  }),
  generatedAt: z.iso.datetime(),
  standard: z.literal(STANDARD),
  summary: summarySchema,
  /** Confirmed violations, most severe first. */
  groups: z.array(findingGroupSchema),
  /** Checks axe could not decide automatically; a person has to look at them. */
  needsReview: z.array(findingGroupSchema),
  disclaimer: z.string(),
});

export type Rule = z.infer<typeof ruleSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type FindingGroup = z.infer<typeof findingGroupSchema>;
export type ReportSummary = z.infer<typeof summarySchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
export type AuditTarget = AuditReport["target"];

/** Validates a report loaded from disk or pasted by a user. */
export function parseAuditReport(input: unknown): AuditReport {
  const parsed = auditReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidReportError(`Not a valid Allytic report: ${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
