import { describe, expect, it } from "vitest";
import { sampleAxeResults } from "./testing/sample-axe-results.js";
import { sampleReport } from "./testing/sample-report.js";
import { baselineCounts, judgePatch, selectorsForRule } from "./verify.js";

const baseline = baselineCounts(sampleReport());

/** axe output after a patch: the sample page with some violations removed or added. */
function axeAfter(change: (violations: ReturnType<typeof sampleAxeResults>["violations"]) => void) {
  const results = sampleAxeResults();
  change(results.violations);
  return results;
}

describe("baselineCounts", () => {
  it("counts failing elements per rule across groups", () => {
    expect(Object.fromEntries(baseline)).toEqual({
      "image-alt": 3,
      "color-contrast": 1,
      "heading-order": 1,
    });
  });
});

describe("judgePatch", () => {
  it("verifies a patch that fixes the element and breaks nothing", () => {
    const axeResults = axeAfter((violations) => {
      violations[1]?.nodes.shift();
    });
    expect(
      judgePatch({ applied: true, axeResults, targetStillFails: false }, "image-alt", baseline),
    ).toEqual({ status: "verified", detail: null });
  });

  it("fails when the rule is still reported on the element", () => {
    const verdict = judgePatch(
      { applied: true, axeResults: sampleAxeResults(), targetStillFails: true },
      "image-alt",
      baseline,
    );
    expect(verdict.status).toBe("failed");
    expect(verdict.detail).toMatch(/still reports "image-alt" on the patched element/);
  });

  it("fails when a rule that passed before now fails", () => {
    const axeResults = axeAfter((violations) => {
      violations[1]?.nodes.shift();
      violations.push({
        id: "aria-roles",
        impact: "critical",
        tags: ["wcag2a", "wcag412"],
        description: "",
        help: "",
        helpUrl: "",
        nodes: [{ html: '<img role="imge">', target: ["img"], impact: "critical" }],
      });
    });
    const verdict = judgePatch(
      { applied: true, axeResults, targetStillFails: false },
      "image-alt",
      baseline,
    );
    expect(verdict).toEqual({
      status: "failed",
      detail: "The patch introduced new axe-core violations: aria-roles.",
    });
  });

  it("fails when an already failing rule reports more elements", () => {
    const axeResults = axeAfter((violations) => {
      violations[1]?.nodes.shift();
      violations[0]?.nodes.push({
        html: '<p class="new">Open daily</p>',
        target: [".new"],
        impact: "serious",
        failureSummary: "Fix any of the following:\n  Insufficient contrast of 2.3",
      });
    });
    const verdict = judgePatch(
      { applied: true, axeResults, targetStillFails: false },
      "image-alt",
      baseline,
    );
    expect(verdict.detail).toMatch(/new axe-core violations: color-contrast/);
  });

  it("does not hold other pre-existing violations against the patch", () => {
    // Nothing else changed: the page still has its contrast and heading problems.
    const axeResults = axeAfter((violations) => {
      violations[1]?.nodes.shift();
    });
    expect(
      judgePatch({ applied: true, axeResults, targetStillFails: false }, "image-alt", baseline)
        .status,
    ).toBe("verified");
  });

  it("fails with the reason when the patch could not be applied", () => {
    expect(
      judgePatch(
        { applied: false, reason: "patch.after must be exactly one root element." },
        "image-alt",
        baseline,
      ),
    ).toEqual({
      status: "failed",
      detail: "The patch could not be applied: patch.after must be exactly one root element.",
    });
  });
});

describe("selectorsForRule", () => {
  it("returns top-document selectors of violations and undecided checks", () => {
    expect(selectorsForRule(sampleAxeResults(), "image-alt")).toEqual([
      "img:nth-child(1)",
      "img:nth-child(2)",
    ]);
    expect(selectorsForRule(sampleAxeResults(), "duplicate-id-aria")).toEqual(["#pickup"]);
    expect(selectorsForRule(sampleAxeResults(), "label")).toEqual([]);
  });
});
