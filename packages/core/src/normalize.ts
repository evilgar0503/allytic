import type { AxeNode, AxeRuleResult } from "./axe-results.js";
import { shortHash } from "./hash.js";
import { type Impact, isImpact } from "./impact.js";
import type { Finding, Rule } from "./report-schema.js";
import { wcagFromTags } from "./wcag.js";

/** Longer snippets are cut: they bloat reports and, later, LLM prompts. */
export const MAX_HTML_LENGTH = 600;

/** axe leaves the impact empty on some "incomplete" results; treat those as moderate. */
const FALLBACK_IMPACT: Impact = "moderate";

export interface RuleFindings {
  rule: Rule;
  findings: Finding[];
}

function selectorOf(target: AxeNode["target"]): string {
  // Nested arrays mean "inside this shadow root"; separate arrays mean "inside this frame".
  return target.map((part) => (typeof part === "string" ? part : part.join(" >>> "))).join(" > ");
}

function truncate(html: string): { html: string; htmlTruncated: boolean } {
  if (html.length <= MAX_HTML_LENGTH) return { html, htmlTruncated: false };
  return { html: html.slice(0, MAX_HTML_LENGTH), htmlTruncated: true };
}

function pickImpact(...candidates: (string | null | undefined)[]): Impact {
  return candidates.find(isImpact) ?? FALLBACK_IMPACT;
}

function toRule(result: AxeRuleResult): Rule {
  const wcag = wcagFromTags(result.tags);
  return {
    id: result.id,
    help: result.help,
    description: result.description,
    helpUrl: result.helpUrl,
    tags: result.tags,
    wcagCriteria: wcag.criteria,
    wcagLevel: wcag.level,
    bestPractice: wcag.bestPractice,
  };
}

/** Turns axe rule results into Allytic rules and findings, dropping rules without nodes. */
export function normalizeRuleResults(results: readonly AxeRuleResult[]): RuleFindings[] {
  return results
    .filter((result) => result.nodes.length > 0)
    .map((result) => ({
      rule: toRule(result),
      findings: result.nodes.map((node): Finding => {
        const selector = selectorOf(node.target);
        return {
          id: shortHash(`${result.id}\n${selector}\n${node.html}`),
          ruleId: result.id,
          impact: pickImpact(node.impact, result.impact),
          selector,
          ...truncate(node.html),
          failureSummary: node.failureSummary?.trim() || null,
        };
      }),
    }));
}
