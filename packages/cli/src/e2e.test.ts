import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AuditReport, parseAuditReport } from "@allytic/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runAudit } from "./audit.js";
import { EXIT_ERROR, EXIT_OK, EXIT_THRESHOLD_REACHED, main } from "./main.js";
import { resolveTarget } from "./target.js";
import { type StaticServer, serveDirectory } from "./testing/static-server.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const fixtureRoot = join(repoRoot, "fixtures", "broken-site");

/** The fixture's catalogue of defects: what axe must report on each page, no more, no less. */
const expected = z
  .record(
    z.string(),
    z.object({ violations: z.array(z.string()), needsReview: z.array(z.string()) }),
  )
  .parse(JSON.parse(readFileSync(join(repoRoot, "fixtures", "broken-site.expected.json"), "utf8")));

const outputDirectory = mkdtempSync(join(tmpdir(), "allytic-e2e-"));
let server: StaticServer;

beforeAll(async () => {
  server = await serveDirectory(fixtureRoot);
});

afterAll(async () => {
  await server.close();
  rmSync(outputDirectory, { recursive: true, force: true });
});

function ruleIds(groups: AuditReport["groups"]): string[] {
  return [...new Set(groups.map((group) => group.rule.id))].sort();
}

async function runCli(argv: string[], env: Record<string, string> = {}, cwd = repoRoot) {
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
    env,
  });
  return { exitCode, stdout, stderr };
}

describe("auditing the broken-site fixture over HTTP", () => {
  it.each(Object.entries(expected))(
    "%s reports exactly the catalogued rules",
    async (page, rules) => {
      const target = resolveTarget(`${server.origin}/${page}`, repoRoot);
      const report = await runAudit(target, { timeoutMs: 30_000, wcagOnly: false });

      expect(ruleIds(report.groups)).toEqual(rules.violations);
      expect(ruleIds(report.needsReview)).toEqual(rules.needsReview);
      expect(report.engine.name).toBe("axe-core");
      expect(report.target.url).toBe(`${server.origin}/${page}`);
    },
  );

  it("leaves out best practices with --wcag-only", async () => {
    const target = resolveTarget(`${server.origin}/index.html`, repoRoot);
    const report = await runAudit(target, { timeoutMs: 30_000, wcagOnly: true });
    const ids = ruleIds(report.groups);

    expect(ids).toContain("image-alt");
    for (const bestPractice of ["heading-order", "region", "tabindex"]) {
      expect(ids).not.toContain(bestPractice);
    }
    expect(report.groups.every((group) => group.rule.wcagCriteria.length > 0)).toBe(true);
  });
});

describe("the allytic command", () => {
  it("audits a local file and prints a plain-text report to stdout", async () => {
    const { exitCode, stdout, stderr } = await runCli(["audit", "fixtures/broken-site/index.html"]);

    expect(exitCode).toBe(EXIT_OK);
    expect(stdout).toMatch(/^Allytic accessibility report\nTarget: {2}file:/);
    expect(stdout).toContain("CRITICAL  Images must have alternative text");
    expect(stdout).toContain("Note: Automated testing only detects part");
    expect(stderr).toMatch(/allytic: \d+ issues in \d+ rules/);
    // No model is involved unless --fix is passed.
    expect(stdout).not.toContain("AI");
    expect(stderr).not.toContain("asking");
  });

  it("prints Markdown when asked, with one summary row per rule", async () => {
    const { stdout } = await runCli(["audit", "fixtures/broken-site/index.html", "-f", "markdown"]);
    expect(stdout).toMatch(/^# Allytic accessibility report/);
    // The two contrast groups (different markup) are a single row in the summary table.
    expect(
      stdout.match(/^\| Serious \| Elements must meet minimum color contrast.*\| 2 \|$/gm),
    ).toHaveLength(1);
  });

  it("writes every requested format into --output-dir", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "audit",
      "fixtures/broken-site/forms.html",
      "--format",
      "text,json,markdown,html,sarif",
      "--output-dir",
      outputDirectory,
    ]);

    expect(exitCode).toBe(EXIT_OK);
    expect(stdout).toBe("");
    expect(stderr.match(/allytic: wrote /g)).toHaveLength(5);

    const report = parseAuditReport(
      JSON.parse(readFileSync(join(outputDirectory, "allytic-report.json"), "utf8")),
    );
    expect(report.target.kind).toBe("file");
    expect(ruleIds(report.groups)).toEqual(expected["forms.html"]?.violations);

    const sarif = z
      .object({
        runs: z.array(
          z.object({
            results: z.array(
              z.object({
                locations: z.array(
                  z.object({
                    physicalLocation: z.object({ artifactLocation: z.object({ uri: z.string() }) }),
                  }),
                ),
              }),
            ),
          }),
        ),
      })
      .parse(JSON.parse(readFileSync(join(outputDirectory, "allytic-report.sarif"), "utf8")));
    const results = sarif.runs[0]?.results ?? [];
    expect(results).toHaveLength(report.summary.findings);
    expect(results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      "fixtures/broken-site/forms.html",
    );
  });

  it("generates an HTML report that has no detectable issues of its own", async () => {
    const htmlPath = join(outputDirectory, "self-check.html");
    await runCli(["audit", "fixtures/broken-site/media.html", "-f", "html", "-o", htmlPath]);

    const report = await runAudit(resolveTarget(htmlPath, repoRoot), {
      timeoutMs: 30_000,
      wcagOnly: false,
    });
    expect(
      report.groups.map((group) => `${group.rule.id}: ${group.findings[0]?.selector}`),
    ).toEqual([]);
  });

  it("exits with 1 when --fail-on is reached and 0 when it is not", async () => {
    const failing = await runCli([
      "audit",
      "fixtures/broken-site/index.html",
      "--fail-on",
      "serious",
      "-o",
      join(outputDirectory, "fail-on.md"),
    ]);
    expect(failing.exitCode).toBe(EXIT_THRESHOLD_REACHED);
    expect(failing.stderr).toContain('impact "serious" or worse');

    const cleanReport = join(outputDirectory, "self-check.html");
    const passing = await runCli(["audit", cleanReport, "--fail-on", "minor", "-f", "json"]);
    expect(passing.exitCode).toBe(EXIT_OK);
  });

  it("explains HTTP errors instead of auditing the error page", async () => {
    const { exitCode, stdout, stderr } = await runCli(["audit", `${server.origin}/missing.html`]);
    expect(exitCode).toBe(EXIT_ERROR);
    expect(stdout).toBe("");
    expect(stderr).toContain("responded with HTTP 404. Nothing was audited.");
  });

  it("explains unreachable hosts", async () => {
    // Port 9 (discard) on loopback: nothing listens there.
    const { exitCode, stderr } = await runCli(["audit", "http://127.0.0.1:9/"]);
    expect(exitCode).toBe(EXIT_ERROR);
    expect(stderr).toMatch(/allytic: Could not load http:\/\/127\.0\.0\.1:9\/: /);
  });

  it("reports usage errors without launching a browser", async () => {
    const { exitCode, stderr } = await runCli(["audit", "nope.html"]);
    expect(exitCode).toBe(EXIT_ERROR);
    expect(stderr).toContain("no file exists at");

    const unknown = await runCli(["audit", "x.html", "--format", "pdf"]);
    expect(unknown.exitCode).toBe(EXIT_ERROR);
    expect(unknown.stderr).toContain('Run "allytic --help" for usage.');
  });

  it("prints help and version", async () => {
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(EXIT_OK);
    expect(help.stdout).toContain("Usage: allytic audit <url|file>");

    const version = await runCli(["--version"]);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
