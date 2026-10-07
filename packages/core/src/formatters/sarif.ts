import type { Impact } from "../impact.js";
import type { AuditReport, Rule } from "../report-schema.js";
import { wcagLabel } from "./shared.js";

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const INFORMATION_URI = "https://github.com/evilgar0503/allytic";

const LEVELS: Record<Impact, "error" | "warning" | "note"> = {
  critical: "error",
  serious: "error",
  moderate: "warning",
  minor: "note",
};

export interface SarifOptions {
  /**
   * URI recorded as the location of every result. GitHub Code Scanning only links alerts to
   * files of the repository, so callers auditing a local file should pass its repo-relative
   * path. Defaults to the audited URL, which GitHub shows but cannot link.
   */
  artifactUri?: string;
}

function ruleDescriptor(rule: Rule, impact: Impact) {
  return {
    id: rule.id,
    name: rule.id,
    shortDescription: { text: rule.help },
    fullDescription: { text: rule.description },
    helpUri: rule.helpUrl,
    help: {
      text: `${rule.description} ${wcagLabel(rule)}. More information: ${rule.helpUrl}`,
      markdown: `${rule.description}\n\n${wcagLabel(rule)} · [Rule documentation](${rule.helpUrl})`,
    },
    defaultConfiguration: { level: LEVELS[impact] },
    properties: { tags: ["accessibility", ...rule.tags] },
  };
}

/** SARIF 2.1.0 log with one result per failing element. "Needs review" checks are left out. */
export function formatSarif(report: AuditReport, options: SarifOptions = {}): string {
  const uri = options.artifactUri ?? report.target.url;

  const rules = new Map<string, ReturnType<typeof ruleDescriptor>>();
  for (const group of report.groups) {
    // Groups are sorted most severe first, so the first one seen sets the rule's default level.
    if (!rules.has(group.rule.id))
      rules.set(group.rule.id, ruleDescriptor(group.rule, group.impact));
  }
  const ruleIndex = new Map([...rules.keys()].map((id, index) => [id, index]));

  const results = report.groups.flatMap((group) =>
    group.findings.map((finding) => ({
      ruleId: finding.ruleId,
      ruleIndex: ruleIndex.get(finding.ruleId) ?? -1,
      level: LEVELS[finding.impact],
      message: {
        text: [
          `${group.rule.help} (${finding.impact}). Element: ${finding.selector}`,
          // The explanation is AI-written; it is labelled so in the alert itself.
          ...(group.suggestion ? [`AI explanation: ${group.suggestion.explanation}`] : []),
        ].join(" "),
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri },
            // axe reports DOM nodes, not source positions; line 1 is a placeholder.
            region: { startLine: 1, snippet: { text: finding.html } },
          },
          logicalLocations: [{ fullyQualifiedName: finding.selector, kind: "element" }],
        },
      ],
      partialFingerprints: { "allyticFinding/v1": finding.id },
    })),
  );

  const log = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            informationUri: INFORMATION_URI,
            rules: [...rules.values()],
          },
        },
        automationDetails: { id: `allytic/${report.target.url}` },
        invocations: [{ executionSuccessful: true, endTimeUtc: report.generatedAt }],
        results,
      },
    ],
  };

  return `${JSON.stringify(log, null, 2)}\n`;
}
