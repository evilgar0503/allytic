# Allytic

[![CI](https://github.com/evilgar0503/allytic/actions/workflows/ci.yml/badge.svg)](https://github.com/evilgar0503/allytic/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**An accessibility auditor that proves its own fixes.** Allytic finds WCAG 2.2 AA issues with
[axe-core](https://github.com/dequelabs/axe-core), asks an LLM to explain each one and propose a
code patch, then **applies the patch and re-runs axe**. A fix is only labelled *Verified* when the
rule stops failing and no new violations appear.

> **Status: early development.** The CLI already audits pages and writes JSON, Markdown, HTML and
> SARIF reports. AI explanations, verified patches, the API and the web app are being built in
> phases; see the [roadmap](docs/IDEA.md#11-roadmap).

> **Automated testing only covers part of WCAG.** Allytic never claims a site is "compliant" or
> legally conformant. Manual review and testing with assistive technology users are still needed.

<!-- TODO(phase 7): demo GIF -->

## Demo

Coming in phase 5. The demo only ever audits
[`fixtures/broken-site`](fixtures/broken-site) (live at <https://allytic-broken-site.pages.dev>),
a deliberately broken site that ships with this
repository, never third-party websites.

## Usage

Not published to npm yet (phase 6). From a clone:

```bash
corepack enable
pnpm install
pnpm --filter allytic exec playwright install chromium
pnpm build
node packages/cli/dist/bin.js audit https://allytic-broken-site.pages.dev
```

```text
allytic audit <url|file> [options]

  -f, --format <format>  json, markdown, html, sarif (default: markdown); repeat or use commas
  -o, --output <file>    write the report to a file instead of stdout
      --output-dir <dir> write one allytic-report.<ext> per format
      --fail-on <impact> exit with code 1 on minor, moderate, serious or critical issues
      --wcag-only        skip axe "best practice" rules that are not part of WCAG
      --timeout <ms>     page load timeout (default: 30000)
```

Any public URL can be audited, including sites you do not own. Local HTML files work too.
The report goes to stdout and the status line to stderr, so it can be piped:

```bash
node packages/cli/dist/bin.js audit ./dist/index.html --format sarif > results.sarif
```

Planned GitHub Action (phase 6):

```yaml
- uses: evilgar0503/allytic@v1
  with:
    url: http://localhost:4173
```

## Architecture

| Workspace | Role |
| --- | --- |
| `packages/core` | Domain types, axe result normalization and grouping, LLM layer, patch verification. No Node or DOM dependencies. |
| `packages/cli` | `allytic audit <url\|file>` with Playwright. Outputs JSON, Markdown, HTML and SARIF. |
| `packages/action` | GitHub Action: runs the CLI, uploads SARIF, comments on the PR. |
| `apps/api` | Cloudflare Worker that orchestrates URL audits (Browser Rendering, Workers AI, KV). |
| `apps/web` | Vite + React SPA: demo, URL audit, paste HTML (fully client-side), report viewer. |
| `fixtures/broken-site` | Intentionally inaccessible demo target. |
| `evals/` | Dataset and harness comparing free LLMs on verified-fix rate. |

Everything runs on free tiers with no credit card. Design decisions are recorded as short ADRs
in [`docs/IDEA.md`](docs/IDEA.md) (in Spanish).

## Evals

Coming in phase 4: verified-fix rate, regression rate, latency, tokens and cost per model.

## Security

- URL audits are guarded against SSRF in two layers (request validation in the Worker and
  per-request interception in the remote browser). The residual DNS-rebinding risk is documented
  rather than hidden.
- Audited HTML is treated as untrusted data in prompts; model output is schema-validated and a
  patch only counts if axe verifies it.
- Bring-your-own-key stays in the browser and is never sent to the Allytic backend.
- No secrets in the repository; GitHub Actions are pinned by commit SHA with minimal permissions.

Details: [`docs/IDEA.md`, section 8](docs/IDEA.md#8-seguridad-y-privacidad).

## Limitations

- Automated rules detect only a subset of accessibility problems.
- *Verified* means axe no longer reports the rule on the patched DOM, not that the fix is ideal
  (for example, generated alt text still needs a human check).
- Patches (phase 3) will target the rendered DOM, not your source files.
- One page per run, audited as it is right after loading: no login, no interaction.
- SARIF alerts point at line 1 of the file or at the URL, because axe works on the DOM.
- The hosted demo runs on daily free quotas and can be temporarily unavailable.

## Development

```bash
corepack enable
pnpm install
pnpm --filter allytic exec playwright install chromium   # once, for the end-to-end tests
pnpm check   # lint + typecheck + test + build
```

Requires Node 24.

## License

[MIT](LICENSE)
