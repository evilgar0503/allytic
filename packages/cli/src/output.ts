import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type AuditReport, FILE_EXTENSIONS, formatReport, type ReportFormat } from "@allytic/core";
import { OutputError } from "./errors.js";

export const REPORT_BASENAME = "allytic-report";

export interface OutputPlan {
  formats: readonly ReportFormat[];
  output: string | null;
  outputDir: string | null;
  cwd: string;
  sarifArtifactUri: string;
  stdout: (text: string) => void;
}

async function writeReportFile(path: string, content: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new OutputError(`Could not write ${path}: ${reason}`, { cause: error });
  }
}

/** Writes every requested format and returns the paths written (empty when printing to stdout). */
export async function writeReports(report: AuditReport, plan: OutputPlan): Promise<string[]> {
  const render = (format: ReportFormat) =>
    formatReport(report, format, { sarif: { artifactUri: plan.sarifArtifactUri } });

  if (plan.outputDir !== null) {
    const directory = resolve(plan.cwd, plan.outputDir);
    const written: string[] = [];
    for (const format of plan.formats) {
      const path = join(directory, `${REPORT_BASENAME}.${FILE_EXTENSIONS[format]}`);
      await writeReportFile(path, render(format));
      written.push(path);
    }
    return written;
  }

  const [format = "markdown"] = plan.formats;
  if (plan.output !== null) {
    const path = resolve(plan.cwd, plan.output);
    await writeReportFile(path, render(format));
    return [path];
  }

  plan.stdout(render(format));
  return [];
}
