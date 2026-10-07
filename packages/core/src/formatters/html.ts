import type { Impact } from "../impact.js";
import type { AuditReport, Finding, FindingGroup, Suggestion } from "../report-schema.js";
import {
  aiNotice,
  capitalize,
  instancesLabel,
  patchScopeNote,
  ruleRows,
  summaryLine,
  verificationLabel,
  wcagLabel,
} from "./shared.js";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Everything that comes from the audited page goes through this before reaching the report. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Only http(s) links are rendered as links; anything else is shown as text. */
function safeLink(url: string, label: string): string {
  return /^https?:\/\//i.test(url)
    ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

// No scripts and no external resources: the report is a single file that works offline.
// Colours meet WCAG AA contrast in both schemes; snippets wrap instead of scrolling so there
// are no keyboard-inaccessible scroll regions.
const STYLES = `
:root { color-scheme: light dark; --fg: #1b1b1f; --bg: #ffffff; --muted: #55555e; --border: #c4c4cc;
  --surface: #f4f4f7; --link: #0b57d0; --critical: #a30000; --serious: #8a3b00; --moderate: #5c5200; --minor: #3d4a5c; --verified: #0b5c2e; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #ececf1; --bg: #16161a; --muted: #b4b4c0; --border: #55555e; --surface: #222228;
    --link: #9fc2ff; --critical: #ffb3b3; --serious: #ffc48a; --moderate: #f0e08a; --minor: #c3cfdf; --verified: #8fe0ae; }
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 60rem; padding: 1.5rem 1rem 3rem; font: 1rem/1.6 system-ui, sans-serif;
  color: var(--fg); background: var(--bg); }
h1 { font-size: 1.75rem; line-height: 1.25; }
h2 { margin-top: 2.5rem; font-size: 1.375rem; }
h3 { margin-bottom: 0.25rem; font-size: 1.125rem; }
a { color: var(--link); }
a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
.meta, .muted { color: var(--muted); }
.meta { margin: 0; padding: 0; list-style: none; }
.notice { margin: 1.5rem 0; padding: 0.75rem 1rem; border: 1px solid var(--border);
  border-inline-start: 0.375rem solid var(--serious); background: var(--surface); }
table { width: 100%; border-collapse: collapse; }
caption { margin-bottom: 0.5rem; font-weight: 600; text-align: start; }
th, td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: start; vertical-align: top; }
th { background: var(--surface); }
td.count { text-align: end; font-variant-numeric: tabular-nums; }
.impact { font-weight: 700; }
.impact-critical { color: var(--critical); } .impact-serious { color: var(--serious); }
.impact-moderate { color: var(--moderate); } .impact-minor { color: var(--minor); }
.group { margin-top: 1.5rem; padding: 0.25rem 1rem 1rem; border: 1px solid var(--border); border-radius: 0.5rem; }
.elements { padding-inline-start: 1.25rem; }
.elements li { margin-top: 0.75rem; }
code, pre { font: 0.875rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre { margin: 0.25rem 0 0; padding: 0.5rem 0.75rem; background: var(--surface); border: 1px solid var(--border);
  border-radius: 0.25rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.selector { overflow-wrap: anywhere; }
.suggestion { margin: 1rem 0; padding: 0.25rem 1rem 1rem; border-inline-start: 0.25rem solid var(--link); background: var(--surface); }
.suggestion pre { background: var(--bg); }
.suggestion h4 { margin: 1rem 0 0.25rem; font-size: 1rem; }
.suggestion h5 { margin: 0.75rem 0 0; font-size: 0.875rem; }
.status { font-weight: 700; }
.status-verified { color: var(--verified); }
.status-failed, .status-not-verifiable { color: var(--serious); }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); }
`;

function impactBadge(impact: Impact): string {
  return `<span class="impact impact-${impact}">${capitalize(impact)}</span>`;
}

function suggestionBlock(suggestion: Suggestion): string {
  const { patch } = suggestion;
  let fix = "";
  if (patch) {
    const { status, sentence } = verificationLabel(patch);
    const note = patchScopeNote(patch);
    fix = `
  <h4>Suggested fix for <code class="selector">${escapeHtml(patch.selector)}</code></h4>
  <p><span class="status status-${patch.verification.status}">${escapeHtml(status)}.</span> ${escapeHtml(sentence)}${note ? ` ${escapeHtml(note)}` : ""}</p>
  <h5>Before</h5>
  <pre><code>${escapeHtml(patch.before)}</code></pre>
  <h5>After</h5>
  <pre><code>${escapeHtml(patch.after)}</code></pre>`;
  }
  return `<div class="suggestion">
  <h4>Why it matters</h4>
  <p>${escapeHtml(suggestion.explanation)}</p>
  <h4>Who is affected</h4>
  <p>${escapeHtml(suggestion.affects)}</p>${fix}
  <p class="muted">Written by ${escapeHtml(suggestion.model)}.</p>
</div>`;
}

function findingItem(finding: Finding): string {
  const summary = finding.failureSummary
    ? `<p class="muted">${escapeHtml(finding.failureSummary).replace(/\n/g, "<br>")}</p>`
    : "";
  return `<li>
  <code class="selector">${escapeHtml(finding.selector)}</code>
  <pre><code>${escapeHtml(finding.html)}${finding.htmlTruncated ? "…" : ""}</code></pre>
  ${summary}
</li>`;
}

function groupSection(group: FindingGroup): string {
  const { rule } = group;
  // Deliberately not a named region: a rule can have several groups with the same heading,
  // and landmarks with identical names are an accessibility problem of their own.
  return `<section class="group">
  <h3 id="group-${group.id}">${escapeHtml(rule.help)}</h3>
  <p>${impactBadge(group.impact)} · ${escapeHtml(wcagLabel(rule))} · ${instancesLabel(group)} · rule ${safeLink(rule.helpUrl, rule.id)}</p>
  <p>${escapeHtml(rule.description)}</p>
  ${group.suggestion ? suggestionBlock(group.suggestion) : ""}
  <ul class="elements">
${group.findings.map(findingItem).join("\n")}
  </ul>
</section>`;
}

function summaryTable(report: AuditReport): string {
  const rows = ruleRows(report.groups)
    .map(
      (row) => `<tr>
  <td>${impactBadge(row.impact)}</td>
  <th scope="row"><a href="#group-${row.firstGroupId}">${escapeHtml(row.rule.help)}</a></th>
  <td>${escapeHtml(wcagLabel(row.rule))}</td>
  <td class="count">${row.elements}</td>
</tr>`,
    )
    .join("\n");
  return `<table>
  <caption>Issues by rule, most severe first</caption>
  <thead>
    <tr><th scope="col">Impact</th><th scope="col">Issue</th><th scope="col">WCAG</th><th scope="col">Elements</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

function needsReviewSection(report: AuditReport): string {
  if (report.needsReview.length === 0) return "";
  const items = report.needsReview
    .map(
      (group) =>
        `<li>${escapeHtml(group.rule.help)} — ${instancesLabel(group)} (rule ${safeLink(group.rule.helpUrl, group.rule.id)})</li>`,
    )
    .join("\n");
  return `<h2>Needs manual review</h2>
<p>axe-core could not decide these checks automatically. They are not counted as issues.</p>
<ul>
${items}
</ul>`;
}

/** Self-contained, script-free HTML report. */
export function formatHtml(report: AuditReport): string {
  const { target } = report;
  const hasFindings = report.summary.findings > 0;
  const notice = aiNotice(report);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeHtml(`${report.tool.name} ${report.tool.version}`)}">
<title>Allytic accessibility report — ${escapeHtml(target.title ?? target.url)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>Allytic accessibility report</h1>
  <ul class="meta">
    <li><strong>Target:</strong> ${safeLink(target.url, target.url)}${target.title ? ` (${escapeHtml(target.title)})` : ""}</li>
    <li><strong>Checked against:</strong> ${escapeHtml(`${report.standard} rules of ${report.engine.name} ${report.engine.version}`)}</li>
    <li><strong>Generated:</strong> <time datetime="${escapeHtml(report.generatedAt)}">${escapeHtml(report.generatedAt)}</time></li>
  </ul>
</header>
<main>
  <p class="notice"><strong>Not a conformance statement.</strong> ${escapeHtml(report.disclaimer)}</p>
  ${notice ? `<p class="notice"><strong>AI-generated content.</strong> ${escapeHtml(notice)}</p>` : ""}
  <h2>Summary</h2>
  <p>${escapeHtml(capitalize(summaryLine(report)))}.</p>
  ${hasFindings ? summaryTable(report) : ""}
  ${hasFindings ? `<h2>Issues</h2>\n${report.groups.map(groupSection).join("\n")}` : ""}
  ${needsReviewSection(report)}
</main>
<footer>
  <p class="muted">Generated by ${escapeHtml(`${report.tool.name} ${report.tool.version}`)}.</p>
</footer>
</body>
</html>
`;
}
