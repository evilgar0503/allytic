import type { AuditReport, FindingGroup } from "../report-schema.js";
import {
  aiNotice,
  capitalize,
  instancesLabel,
  patchScopeNote,
  pluralize,
  summaryLine,
  verificationLabel,
  wcagLabel,
} from "./shared.js";

const MAX_ELEMENTS_PER_GROUP = 5;
const INDENT = "  ";

/**
 * Terminals interpret control characters; text from the audited page must not be able to
 * move the cursor or recolour the output.
 */
function printable(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

function oneLine(text: string): string {
  return printable(text).replace(/\s+/g, " ").trim();
}

function block(text: string, prefix: string): string[] {
  return printable(text)
    .split("\n")
    .map((line) => `${prefix}${line}`.trimEnd());
}

function groupLines(group: FindingGroup): string[] {
  const { rule, suggestion } = group;
  const lines = [
    `${group.impact.toUpperCase()}  ${oneLine(rule.help)}`,
    `${INDENT}${rule.id} · ${wcagLabel(rule)} · ${instancesLabel(group)}`,
  ];

  for (const finding of group.findings.slice(0, MAX_ELEMENTS_PER_GROUP)) {
    lines.push(`${INDENT}- ${oneLine(finding.selector)}`);
  }
  if (group.findings.length > MAX_ELEMENTS_PER_GROUP) {
    lines.push(`${INDENT}  …and ${group.findings.length - MAX_ELEMENTS_PER_GROUP} more`);
  }

  if (suggestion) {
    lines.push(`${INDENT}Why: ${oneLine(suggestion.explanation)}`);
    lines.push(`${INDENT}Who: ${oneLine(suggestion.affects)}`);
    if (suggestion.patch) {
      const { status, sentence } = verificationLabel(suggestion.patch);
      lines.push(`${INDENT}Fix [${status}] for ${oneLine(suggestion.patch.selector)}`);
      if (suggestion.patch.verification.status !== "verified") {
        lines.push(`${INDENT}${INDENT}${oneLine(sentence)}`);
      }
      const note = patchScopeNote(suggestion.patch);
      if (note) lines.push(`${INDENT}${INDENT}${note}`);
      lines.push(...block(suggestion.patch.before, `${INDENT}${INDENT}- `));
      lines.push(...block(suggestion.patch.after, `${INDENT}${INDENT}+ `));
    }
  }
  return [...lines, ""];
}

/** Compact report for reading in a terminal. */
export function formatText(report: AuditReport): string {
  const { target } = report;
  const lines = [
    "Allytic accessibility report",
    `Target:  ${oneLine(target.url)}${target.title ? ` (${oneLine(target.title)})` : ""}`,
    `Checked: ${report.standard} rules of ${report.engine.name} ${report.engine.version}`,
    "",
    `${capitalize(summaryLine(report))}.`,
    "",
    ...report.groups.flatMap(groupLines),
  ];

  if (report.needsReview.length > 0) {
    lines.push(
      `Needs manual review (${pluralize(report.summary.needsReview, "check")}, not counted as issues):`,
      ...report.needsReview.map(
        (group) => `${INDENT}- ${oneLine(group.rule.help)} (${instancesLabel(group)})`,
      ),
      "",
    );
  }

  const notice = aiNotice(report);
  if (report.ai && notice) {
    lines.push(
      `AI: ${pluralize(report.ai.verifiedPatches, "verified patch", "verified patches")} out of ${pluralize(report.ai.suggestions, "suggestion")} (${pluralize(report.ai.llmCalls, "model call")}, ${pluralize(report.ai.cacheHits, "cache hit")}).`,
      notice,
      "",
    );
  }

  lines.push(`Note: ${report.disclaimer}`, "");
  return lines.join("\n");
}
