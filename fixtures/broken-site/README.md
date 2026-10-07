# broken-site fixture

A small static site ("Harbor Coffee", fictional) with **intentional** accessibility defects.
It is the only target the public demo audits, and the oracle for the CLI end-to-end tests.

- No build step: plain HTML and CSS, deployed as-is to Cloudflare Pages.
- Every defect is marked in the source with a `DEFECT <axe-rule-id>` comment.
- Excluded from Biome on purpose: the markup must stay broken.
- Served with `noindex` so it never shows up in search results.

## Catalogue of expected findings

The rule ids are the ones axe-core is **expected** to report. The catalogue is validated
against real axe output in phase 2 (CLI e2e tests); until then treat it as a specification,
not as measured results.

### `index.html`

| axe rule | Element | WCAG |
| --- | --- | --- |
| `html-has-lang` | `<html>` without `lang` | 3.1.1 |
| `meta-viewport` | `user-scalable=no` | 1.4.4 |
| `heading-order` | `<h1>` followed by `<h4>` | best practice |
| `image-alt` | `<img src="img/beans.svg">` | 1.1.1 |
| `color-contrast` | `.muted` paragraph, `.badge` | 1.4.3 |
| `link-name` | icon-only link | 2.4.4, 4.1.2 |
| `button-name` | icon-only button | 4.1.2 |
| `list` | `<ul>` with a `<div>` child | 1.3.1 |
| `tabindex` | `tabindex="3"` | best practice |
| `target-size` | `.pager` links (12×12 px) | 2.5.8 |

### `forms.html`

| axe rule | Element | WCAG |
| --- | --- | --- |
| `label` | name input with placeholder only | 1.3.1, 4.1.2 |
| `autocomplete-valid` | `autocomplete="nope"` | 1.3.5 |
| `select-name` | unlabelled `<select>` | 4.1.2 |
| `aria-required-attr` | `role="checkbox"` without `aria-checked` | 4.1.2 |
| `aria-valid-attr-value` | `aria-expanded="yes"` | 4.1.2 |
| `aria-roles` | `role="buton"` | 4.1.2 |
| `duplicate-id-aria` | two `id="pickup"` | 4.1.2 |
| `aria-hidden-focus` | button inside `aria-hidden="true"` | 4.1.2 |
| `nested-interactive` | link inside a button | 4.1.2 |

### `media.html`

| axe rule | Element | WCAG |
| --- | --- | --- |
| `html-lang-valid` | `lang="xx-broken"` | 3.1.1 |
| `document-title` | missing `<title>` | 2.4.2 |
| `marquee` | `<marquee>` | 2.2.2 |
| `frame-title` | untitled `<iframe>` | 4.1.2 |
| `role-img-alt` | `role="img"` without a name | 1.1.1 |
| `td-headers-attr` | `headers="opening"` | 1.3.1 |
| `definition-list` | `<dl>` with a `<p>` child | 1.3.1 |
| `input-image-alt` | `<input type="image">` without `alt` | 1.1.1, 4.1.2 |

### Defects axe cannot detect

Included deliberately, to show what automated testing misses:

| Defect | Where | WCAG |
| --- | --- | --- |
| Focus indicator removed (`*:focus { outline: none }`) | `styles.css` | 2.4.7 |
