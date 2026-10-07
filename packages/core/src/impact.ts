/** Impact levels reported by axe-core, ordered from least to most severe. */
export const IMPACT_LEVELS = ["minor", "moderate", "serious", "critical"] as const;

export type Impact = (typeof IMPACT_LEVELS)[number];

export function isImpact(value: unknown): value is Impact {
  // Widening cast only: Array.includes on a tuple of literals rejects a plain string.
  return typeof value === "string" && (IMPACT_LEVELS as readonly string[]).includes(value);
}

/** True when `impact` is at least as severe as `threshold` (used by `--fail-on`). */
export function meetsImpactThreshold(impact: Impact, threshold: Impact): boolean {
  return IMPACT_LEVELS.indexOf(impact) >= IMPACT_LEVELS.indexOf(threshold);
}
