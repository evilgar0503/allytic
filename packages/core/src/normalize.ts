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

/** Separators that cannot be mistaken for CSS combinators such as ">". */
const FRAME_SEPARATOR = " >> ";
const SHADOW_SEPARATOR = " >>> ";

function selectorOf(target: AxeNode["target"]): string {
  // Nested arrays mean "inside this shadow root"; separate entries mean "inside this frame".
  return target
    .map((part) => (typeof part === "string" ? part : part.join(SHADOW_SEPARATOR)))
    .join(FRAME_SEPARATOR);
}

function scopeOf(target: AxeNode["target"]): Finding["scope"] {
  if (target.some((part) => typeof part !== "string")) return "shadow";
  return target.length > 1 ? "frame" : "page";
}

/**
 * Removes the indentation that the element had in its source file from every line but the
 * first (which axe already trims), so that snippets read naturally in reports and prompts.
 */
export function dedent(html: string): string {
  const [first, ...rest] = html.split("\n");
  const indents = rest
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  if (indents.length === 0) return html;
  const common = Math.min(...indents);
  return [first, ...rest.map((line) => line.slice(common))].join("\n");
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
          scope: scopeOf(node.target),
          ...truncate(dedent(node.html)),
          failureSummary: node.failureSummary?.trim() || null,
        };
      }),
    }));
}
