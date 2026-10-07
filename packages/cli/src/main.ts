import { AllyticError, hasFindingsAtOrAbove, summaryLine } from "@allytic/core";
import { HELP, parseCommand } from "./args.js";
import { runAudit } from "./audit.js";
import { UsageError } from "./errors.js";
import { writeReports } from "./output.js";
import { resolveTarget, sarifArtifactUri } from "./target.js";
import { toolVersion } from "./version.js";

export const EXIT_OK = 0;
export const EXIT_THRESHOLD_REACHED = 1;
export const EXIT_ERROR = 2;

/** Everything the CLI touches outside its arguments, injectable for tests. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

/** Runs the CLI and returns the process exit code. Never throws. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const command = parseCommand(argv);

    if (command.name === "help") {
      io.stdout(HELP);
      return EXIT_OK;
    }
    if (command.name === "version") {
      io.stdout(`${toolVersion()}\n`);
      return EXIT_OK;
    }

    const { options } = command;
    const target = resolveTarget(options.target, io.cwd);
    const report = await runAudit(target, {
      timeoutMs: options.timeoutMs,
      wcagOnly: options.wcagOnly,
    });

    const written = await writeReports(report, {
      formats: options.formats,
      output: options.output,
      outputDir: options.outputDir,
      cwd: io.cwd,
      sarifArtifactUri: sarifArtifactUri(target, io.cwd),
      stdout: io.stdout,
    });

    // Status goes to stderr so that stdout stays a clean report that can be piped.
    io.stderr(`allytic: ${summaryLine(report)}\n`);
    if (report.summary.needsReview > 0) {
      io.stderr(`allytic: ${report.summary.needsReview} more checks need manual review\n`);
    }
    for (const path of written) io.stderr(`allytic: wrote ${path}\n`);

    if (options.failOn !== null && hasFindingsAtOrAbove(report, options.failOn)) {
      io.stderr(`allytic: failing because of issues with impact "${options.failOn}" or worse\n`);
      return EXIT_THRESHOLD_REACHED;
    }
    return EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`allytic: ${error.message}\nRun "allytic --help" for usage.\n`);
    } else if (error instanceof AllyticError) {
      io.stderr(`allytic: ${error.message}\n`);
    } else {
      // Unexpected: keep the stack, it is what a bug report needs.
      io.stderr(
        `allytic: unexpected error\n${error instanceof Error ? error.stack : String(error)}\n`,
      );
    }
    return EXIT_ERROR;
  }
}
