import {
  type AuditReport,
  addSuggestions,
  buildReport,
  type LlmCache,
  type LlmProvider,
} from "@allytic/core";
import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, chromium, errors as playwrightErrors } from "playwright";
import { BrowserNotInstalledError, NavigationError } from "./errors.js";
import { createPlaywrightEnvironment } from "./patch-environment.js";
import type { ResolvedTarget } from "./target.js";
import { TOOL_NAME, toolVersion } from "./version.js";

/** axe tags that together make up WCAG 2.2 level A and AA. */
const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BEST_PRACTICE_TAG = "best-practice";

export interface FixOptions {
  provider: LlmProvider;
  cache: LlmCache | null;
  maxLlmCalls: number;
  onProgress?: (event: { done: number; total: number; ruleId: string }) => void;
}

export interface RunAuditOptions {
  timeoutMs: number;
  /** Skip axe rules that are good practice but not part of WCAG. */
  wcagOnly: boolean;
  /** When present, every group gets an AI explanation and a patch that is tried in the page. */
  fix?: FixOptions;
  now?: Date;
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      throw new BrowserNotInstalledError(
        "Chromium is not installed for Playwright. Run: npx playwright install chromium",
        { cause: error },
      );
    }
    throw error;
  }
}

/** Opens the target in headless Chromium, runs axe-core in the page and builds the report. */
export async function runAudit(
  target: ResolvedTarget,
  options: RunAuditOptions,
): Promise<AuditReport> {
  const browser = await launchBrowser();
  try {
    // A fresh context per audit: no cookies, storage or cache shared with anything else.
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const response = await page.goto(target.url, {
        waitUntil: "load",
        timeout: options.timeoutMs,
      });
      // `response` is null for file:// URLs.
      if (response && response.status() >= 400) {
        throw new NavigationError(
          `${target.url} responded with HTTP ${response.status()}. Nothing was audited.`,
        );
      }
    } catch (error) {
      if (error instanceof NavigationError) throw error;
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new NavigationError(
          `${target.url} did not finish loading within ${options.timeoutMs} ms. Try a higher --timeout.`,
          { cause: error },
        );
      }
      const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
      throw new NavigationError(`Could not load ${target.url}: ${reason}`, { cause: error });
    }

    const tags = options.wcagOnly ? WCAG_22_AA_TAGS : [...WCAG_22_AA_TAGS, BEST_PRACTICE_TAG];
    // The same configuration is used for the audit and for every patch check, so that the
    // "no new violations" comparison is between like and like.
    const runAxe = (): Promise<unknown> => new AxeBuilder({ page }).withTags(tags).analyze();

    const report = buildReport({
      axeResults: await runAxe(),
      tool: { name: TOOL_NAME, version: toolVersion() },
      target: { kind: target.kind, input: target.input, title: (await page.title()) || null },
      now: options.now ?? new Date(),
    });
    if (!options.fix) return report;

    return await addSuggestions(report, {
      provider: options.fix.provider,
      cache: options.fix.cache,
      maxLlmCalls: options.fix.maxLlmCalls,
      environment: createPlaywrightEnvironment(page, runAxe),
      ...(options.fix.onProgress ? { onProgress: options.fix.onProgress } : {}),
    });
  } finally {
    await browser.close();
  }
}
