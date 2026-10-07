import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, parseCommand } from "./args.js";
import { UsageError } from "./errors.js";

function auditOptions(argv: string[]) {
  const command = parseCommand(argv);
  if (command.name !== "audit") throw new Error(`expected audit, got ${command.name}`);
  return command.options;
}

const AI_DEFAULTS = { fix: false, provider: null, model: null, maxLlmCalls: 20, cache: true };

describe("parseCommand", () => {
  it("applies defaults", () => {
    expect(auditOptions(["audit", "https://example.test"])).toEqual({
      target: "https://example.test",
      formats: ["text"],
      output: null,
      outputDir: null,
      failOn: null,
      wcagOnly: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...AI_DEFAULTS,
    });
  });

  it("reads the report options", () => {
    expect(
      auditOptions([
        "audit",
        "page.html",
        "-f",
        "sarif",
        "-o",
        "out.sarif",
        "--fail-on",
        "serious",
        "--wcag-only",
        "--timeout",
        "5000",
      ]),
    ).toEqual({
      target: "page.html",
      formats: ["sarif"],
      output: "out.sarif",
      outputDir: null,
      failOn: "serious",
      wcagOnly: true,
      timeoutMs: 5000,
      ...AI_DEFAULTS,
    });
  });

  it("reads the AI options", () => {
    expect(
      auditOptions([
        "audit",
        "page.html",
        "--fix",
        "--provider",
        "openrouter",
        "--model",
        "vendor/model:free",
        "--max-llm-calls",
        "5",
        "--no-cache",
      ]),
    ).toMatchObject({
      fix: true,
      provider: "openrouter",
      model: "vendor/model:free",
      maxLlmCalls: 5,
      cache: false,
    });
  });

  it("accepts repeated and comma-separated formats without duplicates", () => {
    const options = auditOptions([
      "audit",
      "x.html",
      "--format",
      "json,sarif",
      "--format",
      "JSON",
      "--format",
      "html",
      "--output-dir",
      "reports",
    ]);
    expect(options.formats).toEqual(["json", "sarif", "html"]);
    expect(options.outputDir).toBe("reports");
  });

  it("shows help when asked or when called without arguments", () => {
    expect(parseCommand([])).toEqual({ name: "help" });
    expect(parseCommand(["--help"])).toEqual({ name: "help" });
    expect(parseCommand(["audit", "x.html", "-h"])).toEqual({ name: "help" });
  });

  it("shows the version", () => {
    expect(parseCommand(["-v"])).toEqual({ name: "version" });
  });

  it.each([
    [["scan", "x.html"], /Unknown command "scan"/],
    [["audit"], /Missing target/],
    [["audit", "a.html", "b.html"], /Only one target/],
    [["audit", "a.html", "--format", "pdf"], /Unknown format "pdf"/],
    [["audit", "a.html", "--fail-on", "blocker"], /Unknown impact "blocker"/],
    [["audit", "a.html", "--timeout", "soon"], /--timeout must be a positive whole number/],
    [["audit", "a.html", "--timeout", "0"], /--timeout must be a positive whole number/],
    [["audit", "a.html", "-f", "json,html"], /use --output-dir/],
    [["audit", "a.html", "-o", "a.json", "--output-dir", "out"], /either --output or --output-dir/],
    [["audit", "a.html", "--output"], /argument missing/],
    [["audit", "a.html", "--fix", "--max-llm-calls", "0"], /--max-llm-calls must be a positive/],
    [["audit", "a.html", "--fix", "--provider", "openai"], /Unknown provider "openai"/],
    // Options that would be silently ignored are refused instead.
    [["audit", "a.html", "--model", "x"], /--model only applies with --fix/],
    [["audit", "a.html", "--provider", "groq"], /--provider only applies with --fix/],
    [["audit", "a.html", "--no-cache"], /--no-cache only applies with --fix/],
    // Keys are never accepted on the command line, where they would end up in shell history.
    [["audit", "a.html", "--fix", "--api-key", "secret"], /Unknown option '--api-key'/],
  ])("rejects %j with a usage error", (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(UsageError);
    expect(() => parseCommand(argv)).toThrow(message);
  });
});
