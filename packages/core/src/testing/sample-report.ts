import { buildReport } from "../report.js";
import type { AuditReport } from "../report-schema.js";
import { sampleAxeResults } from "./sample-axe-results.js";

export function sampleReport(): AuditReport {
  return buildReport({
    axeResults: sampleAxeResults(),
    tool: { name: "Allytic", version: "1.2.3" },
    target: { kind: "url", input: "example.test/shop", title: "Shop" },
    now: new Date("2026-10-07T12:00:00.000Z"),
  });
}

export function emptyReport(): AuditReport {
  return buildReport({
    axeResults: { ...sampleAxeResults(), violations: [], incomplete: [] },
    tool: { name: "Allytic", version: "1.2.3" },
    target: { kind: "url", input: "example.test/shop", title: null },
    now: new Date("2026-10-07T12:00:00.000Z"),
  });
}

/** The sample report after `--fix`: one group per verification outcome, one without suggestion. */
export function suggestedReport(): AuditReport {
  const report = sampleReport();
  const [first, second, third, fourth] = report.groups;
  if (!first || !second || !third || !fourth) throw new Error("sample report changed shape");

  const base = { model: "test-model", confidence: 0.9 };
  return {
    ...report,
    groups: [
      {
        ...first,
        suggestion: {
          ...base,
          explanation: "The image has no text alternative.",
          affects: "Screen reader users hear nothing useful.",
          patch: {
            selector: "img:nth-child(1)",
            before: '<img src="a.png" width="10">',
            after: '<img src="a.png" width="10" alt="Coffee beans">',
            childrenOmitted: false,
            verification: { status: "verified", detail: null, attempts: 1 },
          },
        },
      },
      {
        ...second,
        suggestion: {
          ...base,
          explanation: "Hostile </p><script>alert(3)</script> explanation with a | pipe.",
          affects: "Everyone `affected`.",
          patch: {
            selector: "iframe#shop >> x-card >>> img.hero",
            before: '<img src="x" class="hero">',
            after: '<img src="x" class="hero" alt="Hero"><script>alert(4)</script>',
            childrenOmitted: false,
            verification: {
              status: "not-verifiable",
              detail:
                "The element is inside a frame or shadow root, where patches cannot be tried yet.",
              attempts: 1,
            },
          },
        },
      },
      {
        ...third,
        suggestion: {
          ...base,
          explanation: "The text is too light.",
          affects: "People with low vision.",
          patch: {
            selector: ".muted",
            before: '<p class="muted"></p>',
            after: '<p class="muted" style="color:#999"></p>',
            childrenOmitted: true,
            verification: {
              status: "failed",
              detail: 'axe-core still reports "color-contrast" on the patched element.',
              attempts: 2,
            },
          },
        },
      },
      fourth,
    ],
    ai: {
      provider: "test-provider",
      model: "test-model",
      llmCalls: 4,
      cacheHits: 1,
      inputTokens: 1200,
      outputTokens: 300,
      suggestions: 3,
      verifiedPatches: 1,
      skippedGroups: 1,
      stoppedEarly: null,
    },
  };
}
