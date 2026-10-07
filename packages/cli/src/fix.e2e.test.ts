import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AuditReport, parseAuditReport } from "@allytic/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { EXIT_ERROR, EXIT_OK, main } from "./main.js";
import {
  type MockLlm,
  type MockLlmReply,
  type MockLlmRequest,
  serveMockLlm,
  suggestionJson,
} from "./testing/mock-llm-server.js";
import { type StaticServer, serveDirectory } from "./testing/static-server.js";

// `allytic audit --fix` end to end: a real browser, real axe-core and the real fixture, with
// only the model replaced by a local server whose answers are scripted per rule.

const repoRoot = resolve(import.meta.dirname, "../../..");
const workDirectory = mkdtempSync(join(tmpdir(), "allytic-fix-"));
let site: StaticServer;
let llm: MockLlm | undefined;

beforeAll(async () => {
  site = await serveDirectory(join(repoRoot, "fixtures", "broken-site"));
});

afterEach(async () => {
  await llm?.close();
  llm = undefined;
});

afterAll(async () => {
  await site.close();
  rmSync(workDirectory, { recursive: true, force: true });
});

const promptSchema = z.object({
  rule: z.object({ id: z.string() }),
  element: z.object({ html: z.string(), childrenOmitted: z.boolean() }),
  previousAttempt: z.object({ problem: z.string() }).optional(),
});

function promptOf(request: MockLlmRequest) {
  return promptSchema.parse(JSON.parse(request.user));
}

/** What the scripted model answers for each rule of fixtures/broken-site/index.html. */
function scriptedModel(request: MockLlmRequest): MockLlmReply {
  const { rule, element, previousAttempt } = promptOf(request);
  switch (rule.id) {
    case "image-alt":
      return suggestionJson(element.html.replace(">", ' alt="Coffee beans">'));
    case "html-has-lang":
      return suggestionJson('<html lang="en"></html>');
    case "heading-order":
      // Wrong at first, right once told why.
      return suggestionJson(
        previousAttempt
          ? "<h2>Freshly roasted every morning</h2>"
          : '<h4 class="tagline">Freshly roasted every morning</h4>',
      );
    case "color-contrast":
      // Never changes the colour: must end up as a failed patch.
      return suggestionJson(
        element.html.replace("<p ", '<p title="hours" ').replace("<span ", '<span title="new" '),
      );
    case "list":
      return suggestionJson("<li>Flat white</li><li>Cold brew</li>");
    case "button-name":
      return "I cannot help with that.";
    case "link-name":
      return suggestionJson(null);
    default:
      return suggestionJson(null);
  }
}

async function runCli(argv: string[], cwd = workDirectory) {
  if (!llm) throw new Error("start the mock model first");
  let stdout = "";
  let stderr = "";
  const exitCode = await main(argv, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: { OLLAMA_BASE_URL: llm.baseURL },
  });
  return { exitCode, stdout, stderr };
}

function readReport(name: string): AuditReport {
  return parseAuditReport(JSON.parse(readFileSync(join(workDirectory, name), "utf8")));
}

function suggestionFor(report: AuditReport, ruleId: string) {
  return report.groups.find((group) => group.rule.id === ruleId)?.suggestion ?? null;
}

describe("allytic audit --fix", () => {
  it("explains, patches and verifies each group against the live page", async () => {
    llm = await serveMockLlm(scriptedModel);

    const { exitCode, stderr } = await runCli([
      "audit",
      `${site.origin}/index.html`,
      "--fix",
      "--provider",
      "ollama",
      "--model",
      "mock-model",
      "--no-cache",
      "-f",
      "json",
      "-o",
      "fixed.json",
    ]);
    expect(stderr).toContain("asking mock-model (ollama)");
    expect(stderr).toContain("markup from the page is sent to that provider");
    expect(exitCode).toBe(EXIT_OK);

    const report = readReport("fixed.json");

    // Fixed on the first answer.
    expect(suggestionFor(report, "image-alt")?.patch).toMatchObject({
      selector: "img",
      before: '<img src="img/beans.svg" width="320" height="180">',
      after: '<img src="img/beans.svg" width="320" height="180" alt="Coffee beans">',
      childrenOmitted: false,
      verification: { status: "verified", detail: null, attempts: 1 },
    });

    // A structural element: only its attributes are shown and changed.
    expect(suggestionFor(report, "html-has-lang")?.patch).toMatchObject({
      before: "<html></html>",
      after: '<html lang="en"></html>',
      childrenOmitted: true,
      verification: { status: "verified", attempts: 1 },
    });

    // Fixed on the retry, after being told why the first patch failed.
    expect(suggestionFor(report, "heading-order")?.patch).toMatchObject({
      after: "<h2>Freshly roasted every morning</h2>",
      verification: { status: "verified", attempts: 2 },
    });
    const headingRequests = (llm?.requests ?? []).filter(
      (request) => promptOf(request).rule.id === "heading-order",
    );
    expect(headingRequests).toHaveLength(2);
    const retry = headingRequests[1];
    expect(retry && promptOf(retry).previousAttempt?.problem).toMatch(
      /still reports "heading-order" on the patched element/,
    );

    // Never fixed: shown, but clearly not verified.
    for (const group of report.groups.filter((entry) => entry.rule.id === "color-contrast")) {
      expect(group.suggestion?.patch?.verification).toMatchObject({
        status: "failed",
        detail: 'axe-core still reports "color-contrast" on the patched element.',
        attempts: 2,
      });
    }

    // Not a single element: cannot even be applied.
    expect(suggestionFor(report, "list")?.patch?.verification).toMatchObject({
      status: "failed",
      detail: "The patch could not be applied: patch.after must be exactly one root element.",
    });

    // Unparseable twice: the group keeps axe's own description.
    expect(suggestionFor(report, "button-name")).toBeNull();

    // An explanation without a patch is a valid answer.
    expect(suggestionFor(report, "link-name")).toMatchObject({
      explanation: "Mock explanation.",
      patch: null,
    });

    expect(report.ai).toMatchObject({
      provider: "ollama",
      model: "mock-model",
      cacheHits: 0,
      verifiedPatches: 3,
      skippedGroups: 1,
      stoppedEarly: null,
    });
    expect(report.ai?.llmCalls).toBe(llm?.requests.length);
    // The audit itself is the same with or without --fix.
    expect(report.summary.findings).toBe(14);
  });

  it("writes an HTML report with suggestions that has no detectable issues of its own", async () => {
    llm = await serveMockLlm(scriptedModel);
    await runCli([
      "audit",
      `${site.origin}/index.html`,
      "--fix",
      "--provider",
      "ollama",
      "--no-cache",
      "-f",
      "html",
      "-o",
      "fixed.html",
    ]);
    const html = readFileSync(join(workDirectory, "fixed.html"), "utf8");
    expect(html).toContain("AI-generated content.");
    expect(html).toContain('class="status status-verified">Verified.');
    expect(html).toContain('class="status status-failed">Not verified.');

    const selfCheck = await runCli(["audit", "fixed.html", "-f", "json", "-o", "self-check.json"]);
    expect(selfCheck.exitCode).toBe(EXIT_OK);
    expect(
      readReport("self-check.json").groups.map(
        (group) => `${group.rule.id}: ${group.findings[0]?.selector}`,
      ),
    ).toEqual([]);
  });

  it("sends page markup only as JSON data and never in the instructions", async () => {
    llm = await serveMockLlm(() => suggestionJson(null));
    await runCli([
      "audit",
      `${site.origin}/forms.html`,
      "--fix",
      "--provider",
      "ollama",
      "--no-cache",
    ]);

    expect(llm.requests.length).toBeGreaterThan(5);
    const systems = new Set(llm.requests.map((request) => request.system));
    expect(systems.size).toBe(1);
    for (const request of llm.requests) {
      expect(request.system).not.toContain("Harbor Coffee");
      expect(() => promptOf(request)).not.toThrow();
    }
  });

  it("respects --max-llm-calls", async () => {
    llm = await serveMockLlm(() => suggestionJson(null));

    const { stderr } = await runCli([
      "audit",
      `${site.origin}/index.html`,
      "--fix",
      "--provider",
      "ollama",
      "--no-cache",
      "--max-llm-calls",
      "3",
      "-f",
      "json",
      "-o",
      "limited.json",
    ]);

    expect(llm.requests).toHaveLength(3);
    expect(stderr).toContain(
      "stopped asking the model early: The limit of 3 model calls was reached.",
    );
    expect(readReport("limited.json").ai).toMatchObject({ llmCalls: 3, suggestions: 3 });
  });

  it("answers from the on-disk cache on the second run", async () => {
    llm = await serveMockLlm(scriptedModel);
    const argv = [
      "audit",
      `${site.origin}/media.html`,
      "--fix",
      "--provider",
      "ollama",
      "-f",
      "json",
      "-o",
    ];

    await runCli([...argv, "first.json"]);
    const callsAfterFirstRun = llm.requests.length;
    expect(callsAfterFirstRun).toBeGreaterThan(0);
    expect(readdirSync(join(workDirectory, ".allytic", "cache")).length).toBe(callsAfterFirstRun);

    const second = await runCli([...argv, "second.json"]);
    expect(llm.requests).toHaveLength(callsAfterFirstRun);
    expect(second.stderr).toMatch(/\(0 model calls, \d+ cache hits\)/);
    expect(readReport("second.json").groups.map((group) => group.suggestion)).toEqual(
      readReport("first.json").groups.map((group) => group.suggestion),
    );
  });

  it("stops with a clear message when the provider rejects the key", async () => {
    llm = await serveMockLlm(() => ({ status: 401, error: "invalid api key" }));

    const { exitCode, stdout, stderr } = await runCli([
      "audit",
      `${site.origin}/index.html`,
      "--fix",
      "--provider",
      "ollama",
      "--no-cache",
    ]);

    expect(exitCode).toBe(EXIT_ERROR);
    expect(stdout).toBe("");
    expect(stderr).toContain("allytic: ollama rejected the API key (HTTP 401).");
  });

  it("still delivers the audit when the provider is rate limited", async () => {
    llm = await serveMockLlm(() => ({
      status: 429,
      error: "quota exhausted",
      headers: { "retry-after-ms": "1" },
    }));

    const { exitCode, stdout, stderr } = await runCli([
      "audit",
      `${site.origin}/index.html`,
      "--fix",
      "--provider",
      "ollama",
      "--no-cache",
    ]);

    expect(exitCode).toBe(EXIT_OK);
    expect(stdout).toContain("CRITICAL  Buttons must have discernible text");
    expect(stderr).toContain(
      "stopped asking the model early: ollama rate limit reached (HTTP 429).",
    );
    expect(stderr).toContain("0 verified patches out of 0 suggestions");
  });

  it("fails fast, before opening a browser, when no provider is configured", async () => {
    let stderr = "";
    const exitCode = await main(["audit", `${site.origin}/index.html`, "--fix"], {
      stdout: () => {},
      stderr: (text) => {
        stderr += text;
      },
      cwd: workDirectory,
      env: {},
    });
    expect(exitCode).toBe(EXIT_ERROR);
    expect(stderr).toContain("--fix needs a model provider");
  });
});
