export const WCAG_LEVELS = ["A", "AA", "AAA"] as const;
export type WcagLevel = (typeof WCAG_LEVELS)[number];

export interface WcagMapping {
  /** Success criteria such as "1.4.3", sorted numerically. */
  criteria: string[];
  /** Conformance level of the rule, or null when the rule is not tied to WCAG. */
  level: WcagLevel | null;
  bestPractice: boolean;
}

const CRITERION_TAG = /^wcag(\d)(\d)(\d{1,2})$/;
const LEVEL_TAG = /^wcag\d{1,2}(a{1,3})$/;
const LEVEL_BY_SUFFIX: Record<string, WcagLevel> = { a: "A", aa: "AA", aaa: "AAA" };

function compareCriteria(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Derives WCAG success criteria and level from axe rule tags (`wcag143`, `wcag2aa`, ...). */
export function wcagFromTags(tags: readonly string[]): WcagMapping {
  const criteria = new Set<string>();
  let level: WcagLevel | null = null;

  for (const tag of tags) {
    const criterion = CRITERION_TAG.exec(tag);
    if (criterion) {
      criteria.add(`${criterion[1]}.${criterion[2]}.${criterion[3]}`);
      continue;
    }
    const levelMatch = LEVEL_TAG.exec(tag);
    if (levelMatch) {
      // A rule carries a single level tag family; keep the first one found.
      level ??= LEVEL_BY_SUFFIX[levelMatch[1] ?? ""] ?? null;
    }
  }

  return {
    criteria: [...criteria].sort(compareCriteria),
    level,
    bestPractice: tags.includes("best-practice"),
  };
}
