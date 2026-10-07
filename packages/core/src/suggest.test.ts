import { describe, expect, it } from "vitest";
import { createMemoryCache } from "./llm/cache.js";
import { LlmError, type LlmProvider, type LlmRequest } from "./llm/types.js";
import { buildReport } from "./report.js";
import type { AuditReport } from "./report-schema.js";
import { addSuggestions, type SuggestOptions } from "./suggest.js";
import { sampleAxeResults } from "./testing/sample-axe-results.js";
import { sampleReport } from "./testing/sample-report.js";
import type { PatchEnvironment, PatchTrial, PatchTrialInput } from "./verify.js";

function answer(after: string | null, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    explanation: "Why it matters.",
    affects: "Who is affected.",
    patch: after === null ? null : { after },
    confidence: 0.9,
    ...extra,
  });
}

/** Provider that replies from a script, one entry per call, and records what it was asked. */
function scriptedProvider(script: (string | Error)[]) {
  const requests: LlmRequest[] = [];
  const provider: LlmProvider = {
    name: "fake",
    model: "fake-model",
    async complete(request) {
      requests.push(request);
      const next = script.shift();
      if (next === undefined) throw new Error("the provider was called more often than scripted");
      if (next instanceof Error) throw next;
      return { text: next, model: "fake-model", usage: { inputTokens: 100, outputTokens: 20 } };
    },
  };
  return { provider, requests };
}

/** axe output of a page whose only problem is the two images of the first sample group. */
function imagesOnlyPage() {
  const results = sampleAxeResults();
  const imageAlt = results.violations[1];
  if (!imageAlt) throw new Error("sample changed shape");
  imageAlt.nodes.length = 2;
  return { ...results, violations: [imageAlt], incomplete: [] };
}

/** Environment in which a patch passes when `passes(input)` says so. */
function fakeEnvironment(
  passes: (input: PatchTrialInput) => boolean | PatchTrial,
  page: () => ReturnType<typeof imagesOnlyPage> = imagesOnlyPage,
) {
  const tried: PatchTrialInput[] = [];
  const environment: PatchEnvironment = {
    async snapshot(selector) {
      return { html: `<live selector="${selector}">`, childrenOmitted: false };
    },
    async tryPatch(input) {
      tried.push(input);
      const outcome = passes(input);
      if (typeof outcome !== "boolean") return outcome;
      // A passing trial is the page minus its first violation.
      const axeResults = page();
      if (outcome) axeResults.violations[0]?.nodes.shift();
      return { applied: true, axeResults, targetStillFails: !outcome };
    },
  };
  return { environment, tried };
}

/** A report with a single group keeps the scripts short. */
function singleGroupReport(): AuditReport {
  return buildReport({
    axeResults: imagesOnlyPage(),
    tool: { name: "Allytic", version: "1.2.3" },
    target: { kind: "url", input: "example.test/shop", title: "Shop" },
    now: new Date("2026-10-07T12:00:00.000Z"),
  });
}

function options(overrides: Partial<SuggestOptions> & Pick<SuggestOptions, "provider">) {
  return { cache: null, environment: null, maxLlmCalls: 20, ...overrides };
}

describe("addSuggestions", () => {
  it("marks a patch as verified when it passes in the page", async () => {
    const { provider, requests } = scriptedProvider([answer('<img alt="Beans">')]);
    const { environment, tried } = fakeEnvironment(() => true);

    const report = await addSuggestions(singleGroupReport(), options({ provider, environment }));

    expect(report.groups[0]?.suggestion).toEqual({
      model: "fake-model",
      explanation: "Why it matters.",
      affects: "Who is affected.",
      confidence: 0.9,
      patch: {
        selector: "img:nth-child(1)",
        before: '<live selector="img:nth-child(1)">',
        after: '<img alt="Beans">',
        childrenOmitted: false,
        verification: { status: "verified", detail: null, attempts: 1 },
      },
    });
    expect(tried).toEqual([
      {
        selector: "img:nth-child(1)",
        ruleId: "image-alt",
        after: '<img alt="Beans">',
        childrenOmitted: false,
      },
    ]);
    // The model saw the live markup, not the stored snippet.
    expect(requests[0]?.user).toContain("<live selector=");
    expect(report.ai).toMatchObject({
      provider: "fake",
      model: "fake-model",
      llmCalls: 1,
      cacheHits: 0,
      inputTokens: 100,
      outputTokens: 20,
      suggestions: 1,
      verifiedPatches: 1,
      skippedGroups: 0,
      stoppedEarly: null,
    });
  });

  it("retries once with the verification error and accepts a patch that then passes", async () => {
    const { provider, requests } = scriptedProvider([
      answer('<img role="presentation">'),
      answer('<img alt="Beans">'),
    ]);
    const { environment } = fakeEnvironment(({ after }) => after.includes("alt="));

    const report = await addSuggestions(singleGroupReport(), options({ provider, environment }));

    expect(report.groups[0]?.suggestion?.patch?.verification).toEqual({
      status: "verified",
      detail: null,
      attempts: 2,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.user).toContain("previousAttempt");
    expect(requests[1]?.user).toContain("still reports");
    expect(requests[1]?.user).toContain('<img role=\\"presentation\\">');
  });

  it("keeps the last patch, marked as failed, when the retry does not pass either", async () => {
    const { provider, requests } = scriptedProvider([
      answer("<img title=a>"),
      answer("<img title=b>"),
    ]);
    const { environment } = fakeEnvironment(() => false);

    const report = await addSuggestions(singleGroupReport(), options({ provider, environment }));

    expect(requests).toHaveLength(2);
    expect(report.groups[0]?.suggestion?.patch).toMatchObject({
      after: "<img title=b>",
      verification: { status: "failed", attempts: 2 },
    });
    expect(report.groups[0]?.suggestion?.patch?.verification.detail).toMatch(/still reports/);
    expect(report.ai?.verifiedPatches).toBe(0);
  });

  it("retries a malformed answer once and then falls back to axe's own description", async () => {
    const { provider, requests } = scriptedProvider(["not json", '{"explanation": 1}']);
    const { environment, tried } = fakeEnvironment(() => true);

    const report = await addSuggestions(singleGroupReport(), options({ provider, environment }));

    expect(requests).toHaveLength(2);
    expect(requests[1]?.user).toContain("did not contain a JSON object");
    expect(tried).toEqual([]);
    expect(report.groups[0]?.suggestion).toBeNull();
    expect(report.ai).toMatchObject({ suggestions: 0, skippedGroups: 1, llmCalls: 2 });
  });

  it("recovers when only the first answer is malformed", async () => {
    const { provider } = scriptedProvider(["Sure! Here you go.", answer('<img alt="Beans">')]);
    const { environment } = fakeEnvironment(() => true);

    const report = await addSuggestions(singleGroupReport(), options({ provider, environment }));

    expect(report.groups[0]?.suggestion?.patch?.verification).toMatchObject({
      status: "verified",
      attempts: 2,
    });
  });

  it("accepts an explanation without a patch and tries nothing", async () => {
    const { provider } = scriptedProvider([answer(null)]);
    const { environment, tried } = fakeEnvironment(() => true);

    const report = await addSuggestions(singleGroupReport(), options({ provider, environment }));

    expect(report.groups[0]?.suggestion).toMatchObject({
      explanation: "Why it matters.",
      patch: null,
    });
    expect(tried).toEqual([]);
  });

  it("reports the reason when the patch could not be applied", async () => {
    const { provider } = scriptedProvider([answer("<p>a</p><p>b</p>"), answer("<p>a</p><p>b</p>")]);
    const { environment } = fakeEnvironment(() => ({
      applied: false,
      reason: "patch.after must be exactly one root element.",
    }));

    const report = await addSuggestions(singleGroupReport(), options({ provider, environment }));

    expect(report.groups[0]?.suggestion?.patch?.verification).toEqual({
      status: "failed",
      detail: "The patch could not be applied: patch.after must be exactly one root element.",
      attempts: 2,
    });
  });

  it("writes suggestions without verifying them when there is no live page", async () => {
    const { provider, requests } = scriptedProvider([answer('<img alt="Beans">')]);

    const report = await addSuggestions(singleGroupReport(), options({ provider }));

    expect(report.groups[0]?.suggestion?.patch).toMatchObject({
      before: '<img src="a.png" width="10">',
      verification: {
        status: "not-verifiable",
        detail: "No live page was available to try the patch.",
        attempts: 1,
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("does not try patches on elements inside frames or shadow roots", async () => {
    const report = sampleReport();
    const framed = { ...report, groups: report.groups.slice(1, 2) };
    const { provider } = scriptedProvider([answer('<img alt="Hero">')]);
    const { environment, tried } = fakeEnvironment(() => true);

    const result = await addSuggestions(framed, options({ provider, environment }));

    expect(tried).toEqual([]);
    expect(result.groups[0]?.suggestion?.patch?.verification).toMatchObject({
      status: "not-verifiable",
      detail: expect.stringMatching(/inside a frame or shadow root/),
    });
  });

  it("answers from the cache without calling the model again", async () => {
    const cache = createMemoryCache();
    const first = scriptedProvider([answer('<img alt="Beans">')]);
    const { environment } = fakeEnvironment(() => true);
    await addSuggestions(
      singleGroupReport(),
      options({ provider: first.provider, environment, cache }),
    );

    const second = scriptedProvider([]);
    const report = await addSuggestions(
      singleGroupReport(),
      options({ provider: second.provider, environment, cache }),
    );

    expect(second.requests).toEqual([]);
    expect(report.ai).toMatchObject({ llmCalls: 0, cacheHits: 1, verifiedPatches: 1 });
  });

  it("does not cache answers that could not be parsed", async () => {
    const cache = createMemoryCache();
    const first = scriptedProvider(["garbage", "garbage"]);
    await addSuggestions(singleGroupReport(), options({ provider: first.provider, cache }));

    const second = scriptedProvider([answer('<img alt="Beans">')]);
    const report = await addSuggestions(
      singleGroupReport(),
      options({ provider: second.provider, cache }),
    );

    expect(second.requests).toHaveLength(1);
    expect(report.ai?.cacheHits).toBe(0);
  });

  it("stops at the call limit and leaves the remaining groups untouched", async () => {
    const { provider, requests } = scriptedProvider([
      answer('<img alt="1">'),
      answer('<img alt="2">'),
    ]);
    const { environment } = fakeEnvironment(() => true);

    const report = await addSuggestions(
      sampleReport(),
      options({ provider, environment, maxLlmCalls: 2 }),
    );

    expect(requests).toHaveLength(2);
    expect(report.groups.map((group) => group.suggestion !== null)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(report.ai).toMatchObject({
      llmCalls: 2,
      suggestions: 2,
      skippedGroups: 2,
      stoppedEarly: "The limit of 2 model calls was reached.",
    });
  });

  it("keeps what it has when the provider becomes unavailable", async () => {
    const { provider } = scriptedProvider([
      answer('<img alt="1">'),
      new LlmError("rate_limited", "fake rate limit reached: slow down"),
    ]);
    const { environment } = fakeEnvironment(() => true);

    const report = await addSuggestions(sampleReport(), options({ provider, environment }));

    expect(report.groups.map((group) => group.suggestion !== null)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(report.ai?.stoppedEarly).toBe("fake rate limit reached: slow down");
  });

  it("fails loudly on configuration errors", async () => {
    const { provider } = scriptedProvider([new LlmError("auth", "fake rejected the API key.")]);
    await expect(addSuggestions(sampleReport(), options({ provider }))).rejects.toThrow(
      "fake rejected the API key.",
    );
  });

  it("leaves the audit results themselves unchanged", async () => {
    const original = sampleReport();
    const { provider } = scriptedProvider([answer(null), answer(null), answer(null), answer(null)]);

    const report = await addSuggestions(original, options({ provider }));

    expect(report.summary).toEqual(original.summary);
    expect(report.groups.map((group) => group.findings)).toEqual(
      original.groups.map((group) => group.findings),
    );
    expect(original.groups.every((group) => group.suggestion === null)).toBe(true);
  });
});
