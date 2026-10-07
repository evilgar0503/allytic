import { describe, expect, it } from "vitest";
import { IMPACT_LEVELS, isImpact, meetsImpactThreshold } from "./impact.js";

describe("isImpact", () => {
  it("accepts every axe impact level", () => {
    for (const level of IMPACT_LEVELS) {
      expect(isImpact(level)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isImpact("blocker")).toBe(false);
    expect(isImpact(null)).toBe(false);
    expect(isImpact(3)).toBe(false);
  });
});

describe("meetsImpactThreshold", () => {
  it("is true for the same level and for more severe ones", () => {
    expect(meetsImpactThreshold("serious", "serious")).toBe(true);
    expect(meetsImpactThreshold("critical", "serious")).toBe(true);
  });

  it("is false for less severe levels", () => {
    expect(meetsImpactThreshold("moderate", "serious")).toBe(false);
    expect(meetsImpactThreshold("minor", "critical")).toBe(false);
  });
});
