import { type CompactAxeResults, runAxeInPage } from "@allytic/page-scripts";
import type { Page } from "playwright-core";

/** axe tags that together make up WCAG 2.2 level A and AA, plus axe's best practices. */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** Same limit as `MAX_HTML_LENGTH` in core: longer snippets would be cut there anyway. */
const MAX_HTML_LENGTH = 600;

/**
 * Loads axe-core into the page. The source is evaluated through the DevTools protocol rather
 * than added as a `<script>` element, so a strict Content-Security-Policy on the audited page
 * cannot block it.
 */
export async function injectAxe(page: Page, axeSource: string): Promise<void> {
  await page.evaluate(axeSource);
}

/**
 * Runs axe inside the page and returns only what Allytic reads. The Worker never sees the
 * full axe output: on the Free plan it has 10 ms of CPU per request, and parsing hundreds of
 * kilobytes of JSON would spend a good part of it.
 */
export function runAxe(page: Page, options: { lean: boolean }): Promise<CompactAxeResults> {
  return page.evaluate(runAxeInPage, {
    tags: AXE_TAGS,
    lean: options.lean,
    maxHtmlLength: MAX_HTML_LENGTH,
  });
}
