import { parseArgs } from "node:util";
import {
  IMPACT_LEVELS,
  type Impact,
  isImpact,
  isReportFormat,
  REPORT_FORMATS,
  type ReportFormat,
} from "@allytic/core";
import { UsageError } from "./errors.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export const HELP = `Usage: allytic audit <url|file> [options]

Audits a page against the WCAG 2.2 AA rules of axe-core.

Arguments:
  <url|file>             An http(s) URL or a path to a local HTML file

Options:
  -f, --format <format>  ${REPORT_FORMATS.join(", ")} (default: markdown).
                         Repeat it or use commas to write several reports.
  -o, --output <file>    Write the report to a file instead of stdout (one format only)
      --output-dir <dir> Write one allytic-report.<ext> per format into this directory
      --fail-on <impact> Exit with code 1 if an issue of this impact or worse is found:
                         ${IMPACT_LEVELS.join(", ")}
      --wcag-only        Skip axe "best practice" rules that are not part of WCAG
      --timeout <ms>     Page load timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes:
  0  audit completed    1  --fail-on threshold reached    2  usage or runtime error

Automated testing only detects part of WCAG. A clean report is not proof of conformance.
`;

export interface AuditOptions {
  target: string;
  formats: ReportFormat[];
  output: string | null;
  outputDir: string | null;
  failOn: Impact | null;
  wcagOnly: boolean;
  timeoutMs: number;
}

export type Command =
  | { name: "help" }
  | { name: "version" }
  | { name: "audit"; options: AuditOptions };

function parseFormats(values: readonly string[]): ReportFormat[] {
  const formats = new Set<ReportFormat>();
  for (const value of values.flatMap((entry) => entry.split(","))) {
    const format = value.trim().toLowerCase();
    if (!isReportFormat(format)) {
      throw new UsageError(
        `Unknown format "${value}". Expected one of: ${REPORT_FORMATS.join(", ")}.`,
      );
    }
    formats.add(format);
  }
  return formats.size > 0 ? [...formats] : ["markdown"];
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new UsageError(`--timeout must be a positive number of milliseconds, got "${value}".`);
  }
  return timeout;
}

function parseFailOn(value: string | undefined): Impact | null {
  if (value === undefined) return null;
  if (!isImpact(value)) {
    throw new UsageError(
      `Unknown impact "${value}" for --fail-on. Expected one of: ${IMPACT_LEVELS.join(", ")}.`,
    );
  }
  return value;
}

/** Parses `process.argv.slice(2)`. Throws `UsageError` with an actionable message. */
export function parseCommand(argv: readonly string[]): Command {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    // node:util reports unknown options and missing values as TypeError.
    throw new UsageError(error instanceof Error ? error.message : String(error), { cause: error });
  }
  const { values, positionals } = parsed;

  if (values.help) return { name: "help" };
  if (values.version) return { name: "version" };

  const [command, target, ...extra] = positionals;
  if (command === undefined) return { name: "help" };
  if (command !== "audit") {
    throw new UsageError(`Unknown command "${command}". The only command is "audit".`);
  }
  if (target === undefined) {
    throw new UsageError("Missing target. Pass a URL or the path to an HTML file.");
  }
  if (extra.length > 0) {
    throw new UsageError(`Unexpected argument "${extra[0]}". Only one target can be audited.`);
  }

  const formats = parseFormats(values.format ?? []);
  const output = values.output ?? null;
  const outputDir = values["output-dir"] ?? null;

  if (output !== null && outputDir !== null) {
    throw new UsageError("Use either --output or --output-dir, not both.");
  }
  if (formats.length > 1 && outputDir === null) {
    throw new UsageError(
      "Several formats were requested: use --output-dir to say where to write them.",
    );
  }

  return {
    name: "audit",
    options: {
      target,
      formats,
      output,
      outputDir,
      failOn: parseFailOn(values["fail-on"]),
      wcagOnly: values["wcag-only"] ?? false,
      timeoutMs: parseTimeout(values.timeout),
    },
  };
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      format: { type: "string", short: "f", multiple: true },
      output: { type: "string", short: "o" },
      "output-dir": { type: "string" },
      "fail-on": { type: "string" },
      "wcag-only": { type: "boolean" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}
