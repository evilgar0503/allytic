import { buildPrompt, buildReport, parseSuggestion, selectorsForRule } from "@allytic/core";
import { applyPatch, snapshotElement, targetStillFails, undoPatch } from "@allytic/page-scripts";
import type { Page } from "playwright-core";
import { injectAxe, runAxe } from "./browser/axe.js";
import { installRequestGuard } from "./browser/guarded-page.js";
import { createRequestGuard } from "./ssrf/guard.js";
import type { DnsResolver } from "./ssrf/resolver.js";

// Phase 3b spike. Question it answers: does a full audit, with the request guard and with
// patch verification, fit in the 10 ms of CPU a Worker gets per request on the Free plan?
//
// A Worker cannot measure its own CPU time (timers do not advance while it computes), so the
// answer comes from outside: the request either succeeds or dies with error 1102, and the
// CPU time of each invocation is in the Workers logs. What this code reports is wall time per
// step and how much work was done, to relate both.

export interface SpikeOptions {
  url: string;
  axeSource: string;
  resolver: DnsResolver;
  /** Run every request of the page through the SSRF guard. */
  guard: boolean;
  /** Number of apply / re-run axe / undo cycles, as `--fix` would do one per group. */
  verifyCycles: number;
  /** Ports the guard accepts; only overridden by tests that use a local server. */
  allowedPorts?: ReadonlySet<string>;
}

export interface SpikeResult {
  url: string;
  findings: number;
  groups: number;
  requestsSeen: number;
  requestsBlocked: number;
  hostsResolved: number;
  verifyCyclesRun: number;
  /** Wall-clock milliseconds per step. Mostly waiting on the browser, not CPU. */
  wallMs: Record<string, number>;
}

const MARKER = "data-allytic-patched";
const UNDO_KEY = "__allyticUndoPatch";

/** A canned model answer, so that prompt building and answer parsing are part of the cost. */
const CANNED_ANSWER = JSON.stringify({
  explanation: "Spike explanation of what is wrong and why it matters.",
  affects: "Spike description of who is affected.",
  patch: { after: "<span></span>" },
  confidence: 0.5,
});

export async function runSpike(page: Page, options: SpikeOptions): Promise<SpikeResult> {
  const wallMs: Record<string, number> = {};
  const timed = async <T>(step: string, work: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    try {
      return await work();
    } finally {
      wallMs[step] = (wallMs[step] ?? 0) + (Date.now() - start);
    }
  };

  const guard = createRequestGuard({
    resolver: options.resolver,
    ...(options.allowedPorts ? { allowedPorts: options.allowedPorts } : {}),
  });
  const log = options.guard ? await timed("guard", () => installRequestGuard(page, guard)) : null;

  await timed("goto", () => page.goto(options.url, { waitUntil: "load", timeout: 30_000 }));
  await timed("injectAxe", () => injectAxe(page, options.axeSource));
  const axeResults = await timed("axe", () => runAxe(page, { lean: false }));

  const report = buildReport({
    axeResults,
    tool: { name: "Allytic", version: "spike" },
    target: { kind: "url", input: options.url, title: await page.title() },
    now: new Date(),
  });

  let verifyCyclesRun = 0;
  const candidates = report.groups.filter((group) => group.findings[0]?.scope === "page");
  for (const group of candidates.slice(0, options.verifyCycles)) {
    const finding = group.findings[0];
    if (!finding) continue;

    const snapshot = await timed("snapshot", () =>
      page.evaluate(snapshotElement, { selector: finding.selector, maxLength: 2000 }),
    );
    if (!snapshot.found) continue;

    // The work the Worker itself does around a model call.
    buildPrompt({
      rule: group.rule,
      html: snapshot.html,
      childrenOmitted: snapshot.childrenOmitted,
      failureSummary: finding.failureSummary,
      pageTitle: report.target.title,
    });
    parseSuggestion(CANNED_ANSWER);

    // A patch that changes nothing: the cost is the same as for a real one.
    const applied = await timed("apply", () =>
      page.evaluate(applyPatch, {
        selector: finding.selector,
        after: snapshot.html,
        childrenOmitted: snapshot.childrenOmitted,
        marker: MARKER,
        undoKey: UNDO_KEY,
      }),
    );
    if (!applied.ok) continue;
    try {
      const after = await timed("verifyAxe", () => runAxe(page, { lean: true }));
      await timed("locate", () =>
        page.evaluate(targetStillFails, {
          selectors: selectorsForRule(after, group.rule.id),
          marker: MARKER,
        }),
      );
      verifyCyclesRun++;
    } finally {
      await timed("undo", () => page.evaluate(undoPatch, { undoKey: UNDO_KEY }));
    }
  }

  return {
    url: report.target.url,
    findings: report.summary.findings,
    groups: report.summary.groups,
    requestsSeen: log?.requests ?? 0,
    requestsBlocked: log?.blocked.length ?? 0,
    hostsResolved: guard.hostCount,
    verifyCyclesRun,
    wallMs,
  };
}
