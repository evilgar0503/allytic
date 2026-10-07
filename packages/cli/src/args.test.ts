import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, parseCommand } from "./args.js";
import { UsageError } from "./errors.js";

function auditOptions(argv: string[]) {
  const command = parseCommand(argv);
  if (command.name !== "audit") throw new Error(`expected audit, got ${command.name}`);
  return command.options;
}

describe("parseCommand", () => {
  it("applies defaults", () => {
    expect(auditOptions(["audit", "https://example.test"])).toEqual({
      target: "https://example.test",
      formats: ["markdown"],
      output: null,
      outputDir: null,
      failOn: null,
      wcagOnly: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  });

  it("reads every option", () => {
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
    [["audit", "a.html", "--timeout", "soon"], /--timeout must be a positive number/],
    [["audit", "a.html", "--timeout", "0"], /--timeout must be a positive number/],
    [["audit", "a.html", "-f", "json,html"], /use --output-dir/],
    [["audit", "a.html", "-o", "a.json", "--output-dir", "out"], /either --output or --output-dir/],
    [["audit", "a.html", "--fix"], /Unknown option '--fix'/],
    [["audit", "a.html", "--output"], /argument missing/],
  ])("rejects %j with a usage error", (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(UsageError);
    expect(() => parseCommand(argv)).toThrow(message);
  });
});
