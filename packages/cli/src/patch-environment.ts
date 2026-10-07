import {
  dedent,
  MAX_PROMPT_HTML_LENGTH,
  type PatchEnvironment,
  selectorsForRule,
} from "@allytic/core";
import { applyPatch, snapshotElement, targetStillFails, undoPatch } from "@allytic/page-scripts";
import type { Page } from "playwright";

const MARKER = "data-allytic-patched";
const UNDO_KEY = "__allyticUndoPatch";

/**
 * Tries patches in the page that was just audited. One patch at a time: each is applied,
 * checked with a fresh axe run and undone before the next one, so results never mix.
 */
export function createPlaywrightEnvironment(
  page: Page,
  runAxe: () => Promise<unknown>,
): PatchEnvironment {
  return {
    async snapshot(selector) {
      const result = await page.evaluate(snapshotElement, {
        selector,
        maxLength: MAX_PROMPT_HTML_LENGTH,
      });
      return result.found
        ? { html: dedent(result.html), childrenOmitted: result.childrenOmitted }
        : null;
    },

    async tryPatch({ selector, ruleId, after, childrenOmitted }) {
      const applied = await page.evaluate(applyPatch, {
        selector,
        after,
        childrenOmitted,
        marker: MARKER,
        undoKey: UNDO_KEY,
      });
      if (!applied.ok) return { applied: false, reason: applied.reason };

      try {
        const axeResults = await runAxe();
        const stillFails = await page.evaluate(targetStillFails, {
          selectors: selectorsForRule(axeResults, ruleId),
          marker: MARKER,
        });
        return { applied: true, axeResults, targetStillFails: stillFails };
      } finally {
        await page.evaluate(undoPatch, { undoKey: UNDO_KEY });
      }
    },
  };
}
