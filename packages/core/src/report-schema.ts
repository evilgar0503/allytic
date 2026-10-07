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

export const VERIFICATION_STATUSES = ["verified", "failed", "not-verifiable"] as const;

const patchSchema = z.object({
  /** Element the patch was written for and tested on. */
  selector: z.string(),
  before: z.string(),
  after: z.string(),
  /** True when before/after show only the element itself and its children are kept as they are. */
  childrenOmitted: z.boolean(),
  verification: z.object({
    /**
     * - verified: with the patch applied, axe no longer reports the rule on the element and
     *   no rule reports more elements than before.
     * - failed: the patch was applied and did not meet that bar.
     * - not-verifiable: the patch could not be tried (see `detail`).
     */
    status: z.enum(VERIFICATION_STATUSES),
    detail: z.string().nullable(),
    /** Model answers used for this group, including the retry. */
    attempts: z.number().int().positive(),
  }),
});

const suggestionSchema = z.object({
  /** Model that wrote it. Always shown next to the text: this is generated content. */
  model: z.string(),
  explanation: z.string(),
  affects: z.string(),
  confidence: z.number().min(0).max(1),
  patch: patchSchema.nullable(),
});

const aiSummarySchema = z.object({
  provider: z.string(),
  model: z.string(),
  llmCalls: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  suggestions: z.number().int().nonnegative(),
  verifiedPatches: z.number().int().nonnegative(),
  /** Groups left with axe's own description, with the reason, e.g. the call limit. */
  skippedGroups: z.number().int().nonnegative(),
  stoppedEarly: z.string().nullable(),
});

const findingSchema = z.object({
  /** Stable across runs as long as the rule, selector and markup do not change. */
  id: z.string(),
  ruleId: z.string(),
  impact: impactSchema,
  selector: z.string(),
  /** "frame" and "shadow" elements are reported but cannot be patched yet. */
  scope: z.enum(["page", "frame", "shadow"]),
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
  /** AI explanation and patch for the first finding of the group; null without `--fix`. */
  suggestion: suggestionSchema.nullable().default(null),
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
  /** Present when AI suggestions were requested. */
  ai: aiSummarySchema.nullable().default(null),
  disclaimer: z.string(),
});

export type Rule = z.infer<typeof ruleSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type FindingGroup = z.infer<typeof findingGroupSchema>;
export type Suggestion = z.infer<typeof suggestionSchema>;
export type Patch = z.infer<typeof patchSchema>;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type AiSummary = z.infer<typeof aiSummarySchema>;
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
