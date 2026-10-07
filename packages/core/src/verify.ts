import { type AxeResults, parseAxeResults } from "./axe-results.js";
import type { AuditReport, VerificationStatus } from "./report-schema.js";

/** Markup of an element as it is in the page right now. */
export interface ElementSnapshot {
  html: string;
  /** True when the element was too large and only its own tag is included. */
  childrenOmitted: boolean;
}

export interface PatchTrialInput {
  selector: string;
  ruleId: string;
  after: string;
  childrenOmitted: boolean;
}

export type PatchTrial =
  /** The patch could not be applied at all, e.g. it is not a single element. */
  | { applied: false; reason: string }
  | {
      applied: true;
      /** Raw output of axe run on the whole page with the patch in place. */
      axeResults: unknown;
      /** True when axe still reports `ruleId` on the patched element or inside it. */
      targetStillFails: boolean;
    };

/**
 * A live page in which patches can be tried. Implemented outside `core`: with Playwright in
 * the CLI and the API, with a sandboxed iframe in the web app.
 */
export interface PatchEnvironment {
  /** Null when the selector no longer matches exactly one element. */
  snapshot(selector: string): Promise<ElementSnapshot | null>;
  /** Applies the patch, re-runs axe, and restores the page before returning. */
  tryPatch(input: PatchTrialInput): Promise<PatchTrial>;
}

export interface Verdict {
  status: Extract<VerificationStatus, "verified" | "failed">;
  /** For a failure: what went wrong, phrased so it can be sent back to the model. */
  detail: string | null;
}

export type RuleCounts = ReadonlyMap<string, number>;

/** Number of failing elements per rule in the original audit. */
export function baselineCounts(report: AuditReport): RuleCounts {
  const counts = new Map<string, number>();
  for (const group of report.groups) {
    counts.set(group.rule.id, (counts.get(group.rule.id) ?? 0) + group.findings.length);
  }
  return counts;
}

function countsOf(axe: AxeResults): RuleCounts {
  return new Map(axe.violations.map((result) => [result.id, result.nodes.length]));
}

/** Selectors of the elements for which axe reports `ruleId`, as violations or as undecided. */
export function selectorsForRule(axeResults: unknown, ruleId: string): string[] {
  const axe = parseAxeResults(axeResults);
  return [...axe.violations, ...axe.incomplete]
    .filter((result) => result.id === ruleId)
    .flatMap((result) => result.nodes)
    .flatMap((node) => {
      // Elements inside frames or shadow roots cannot be matched from the top document.
      const [only, ...others] = node.target;
      return typeof only === "string" && others.length === 0 ? [only] : [];
    });
}

/**
 * Decides whether a tried patch counts as verified. The bar is deliberately strict:
 * the rule must stop failing on the element (an undecided result is not a pass) and no rule,
 * including this one, may report more elements than in the original audit.
 */
export function judgePatch(trial: PatchTrial, ruleId: string, baseline: RuleCounts): Verdict {
  if (!trial.applied) {
    return { status: "failed", detail: `The patch could not be applied: ${trial.reason}` };
  }
  if (trial.targetStillFails) {
    return {
      status: "failed",
      detail: `axe-core still reports "${ruleId}" on the patched element.`,
    };
  }

  const regressions = [...countsOf(parseAxeResults(trial.axeResults))]
    .filter(([rule, count]) => count > (baseline.get(rule) ?? 0))
    .map(([rule]) => rule)
    .sort();
  if (regressions.length > 0) {
    return {
      status: "failed",
      detail: `The patch introduced new axe-core violations: ${regressions.join(", ")}.`,
    };
  }

  return { status: "verified", detail: null };
}
