import { shortHash } from "./hash.js";
import { IMPACT_LEVELS, type Impact } from "./impact.js";
import type { RuleFindings } from "./normalize.js";
import type { Finding, FindingGroup } from "./report-schema.js";

// Quoted attribute values may contain ">", so they are consumed as a unit.
const OPENING_TAG = /^\s*<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/;
const TAG_NAME = /^\s*<([a-zA-Z][\w:-]*)/;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Attributes whose value changes what the element *is*, so it belongs in the pattern. */
const MEANINGFUL_VALUES = new Set(["role", "type"]);

const UNKNOWN_PATTERN = "unknown";

/**
 * Reduces a snippet to the shape of its root element: tag name plus sorted attribute names,
 * e.g. `<img src="a.png" width="2">` becomes `img[src,width]`. Two findings of the same rule
 * with the same pattern almost always need the same kind of fix, so they can share one
 * explanation (and, from phase 3, one LLM call).
 */
export function htmlPattern(html: string): string {
  const tag = OPENING_TAG.exec(html);
  if (!tag?.[1]) {
    // A truncated snippet can end inside an attribute; the tag name is still useful.
    return TAG_NAME.exec(html)?.[1]?.toLowerCase() ?? UNKNOWN_PATTERN;
  }

  const attributes = new Set<string>();
  for (const match of (tag[2] ?? "").matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const value = match[2] ?? match[3] ?? match[4];
    attributes.add(
      MEANINGFUL_VALUES.has(name) && value !== undefined ? `${name}=${value.toLowerCase()}` : name,
    );
  }

  const name = tag[1].toLowerCase();
  return attributes.size === 0 ? name : `${name}[${[...attributes].sort().join(",")}]`;
}

function severity(impact: Impact): number {
  return IMPACT_LEVELS.indexOf(impact);
}

function highestImpact(findings: readonly Finding[]): Impact {
  return findings.reduce<Impact>(
    (highest, finding) => (severity(finding.impact) > severity(highest) ? finding.impact : highest),
    "minor",
  );
}

/** Groups findings by rule and markup pattern, most severe and most frequent first. */
export function groupFindings(ruleFindings: readonly RuleFindings[]): FindingGroup[] {
  const groups: FindingGroup[] = [];

  for (const { rule, findings } of ruleFindings) {
    const byPattern = new Map<string, Finding[]>();
    for (const finding of findings) {
      const pattern = htmlPattern(finding.html);
      const bucket = byPattern.get(pattern);
      if (bucket) bucket.push(finding);
      else byPattern.set(pattern, [finding]);
    }

    for (const [pattern, grouped] of byPattern) {
      groups.push({
        id: shortHash(`${rule.id}\n${pattern}`),
        rule,
        impact: highestImpact(grouped),
        pattern,
        findings: grouped,
        suggestion: null,
      });
    }
  }

  return groups.sort(
    (a, b) =>
      severity(b.impact) - severity(a.impact) ||
      b.findings.length - a.findings.length ||
      a.rule.id.localeCompare(b.rule.id) ||
      a.pattern.localeCompare(b.pattern),
  );
}
