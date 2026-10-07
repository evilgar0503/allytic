import { describe, expect, it } from "vitest";
import { wcagFromTags } from "./wcag.js";

describe("wcagFromTags", () => {
  it("extracts success criteria and level", () => {
    expect(wcagFromTags(["cat.color", "wcag2aa", "wcag143"])).toEqual({
      criteria: ["1.4.3"],
      level: "AA",
      bestPractice: false,
    });
  });

  it("handles two-digit criteria and sorts numerically", () => {
    expect(wcagFromTags(["wcag21aa", "wcag1410", "wcag143", "wcag258"]).criteria).toEqual([
      "1.4.3",
      "1.4.10",
      "2.5.8",
    ]);
  });

  it("does not confuse version tags with criteria", () => {
    expect(wcagFromTags(["wcag2a", "wcag21a", "wcag22aa"]).criteria).toEqual([]);
    expect(wcagFromTags(["wcag22aa"]).level).toBe("AA");
    expect(wcagFromTags(["wcag2aaa"]).level).toBe("AAA");
  });

  it("flags best practices that are not tied to WCAG", () => {
    expect(wcagFromTags(["cat.semantics", "best-practice"])).toEqual({
      criteria: [],
      level: null,
      bestPractice: true,
    });
  });
});
