# Allytic

[![CI](https://github.com/evilgar0503/allytic/actions/workflows/ci.yml/badge.svg)](https://github.com/evilgar0503/allytic/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**An accessibility auditor that proves its own fixes.** Allytic finds WCAG 2.2 AA issues with
[axe-core](https://github.com/dequelabs/axe-core), asks an LLM to explain each one and propose a
code patch, then **applies the patch and re-runs axe**. A fix is only labelled *Verified* when the
rule stops failing and no new violations appear.

> **Status: early development.** The CLI audits pages, asks a model to explain and patch each
> issue, and verifies every patch by re-running axe-core. The hosted API, the web app and the
> model comparison are being built in phases; see the [roadmap](docs/IDEA.md#11-roadmap).

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

Add `--fix` to get an explanation and a verified patch for each issue. It needs a free API key
from [Groq](https://console.groq.com/keys) or [OpenRouter](https://openrouter.ai/settings/keys)
in a `.env` file (see [`.env.example`](.env.example)), or a local [Ollama](https://ollama.com):

```bash
node packages/cli/dist/bin.js audit https://allytic-broken-site.pages.dev --fix
```

```text
CRITICAL  Images must have alternative text
  image-alt · WCAG 1.1.1 (A) · 1 element
  - img
  Why: The <img> element is missing an alt attribute, so screen readers have no text to
       convey what the image shows. [...]
  Who: Screen reader users and other assistive technology users [...]
  Fix [Verified] for img
    - <img src="img/beans.svg" width="320" height="180">
    + <img src="img/beans.svg" width="320" height="180" alt="Coffee beans">
```

*Verified* means the patch was applied in the page, axe-core was run again, the rule no longer
fails on that element and no rule reports more elements than before. It does not mean the fix
is the best one: the model cannot see the image, so that alt text is a guess to be checked.
With `--fix`, markup from the audited page is sent to the model provider you chose.

```text
allytic audit <url|file> [options]

  -f, --format <format>  text, json, markdown, html, sarif (default: text); repeat or use commas
  -o, --output <file>    write the report to a file instead of stdout
      --output-dir <dir> write one allytic-report.<ext> per format
      --fail-on <impact> exit with code 1 on minor, moderate, serious or critical issues
      --wcag-only        skip axe "best practice" rules that are not part of WCAG
      --timeout <ms>     page load timeout (default: 30000)

      --fix                explain each issue, propose a patch and verify it
      --provider <name>    groq, openrouter, ollama (default: the first one with an API key)
      --model <id>         model to use instead of the provider's default
      --max-llm-calls <n>  upper bound of model calls per audit (default: 20)
      --no-cache           do not reuse cached model answers (.allytic/cache)
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
| `packages/cli` | `allytic audit <url\|file>` with Playwright. Outputs text, JSON, Markdown, HTML and SARIF. |
| `packages/page-scripts` | Self-contained functions that run inside the audited page to apply, check and undo a patch. |
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
- Patches target the rendered DOM, not your source files, and change a single element: fixes
  that need to touch another element (adding a `<title>`, for instance) stay unverified.
- One suggestion per group of similar elements, tested on the first one.
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
