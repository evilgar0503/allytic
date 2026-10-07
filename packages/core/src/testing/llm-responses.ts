// Model answers used by the parser tests.
//
// REAL_RESPONSES were captured verbatim from Groq (openai/gpt-oss-120b) on 2026-10-07 while
// auditing fixtures/broken-site/index.html. BROKEN_RESPONSES are the failure shapes the parser
// must survive; they are written by hand after what free models typically get wrong.

export const REAL_RESPONSES = {
  imageAlt: String.raw`{"explanation":"The <img> element is missing an alt attribute, so screen readers have no text to convey what the image shows. Without alternative text, users who cannot see the image miss important information. Adding a concise alt description fixes this.","affects":"Screen reader users and other assistive technology users who rely on text alternatives to understand visual content.","patch":{"after":"<img src=\"img/beans.svg\" width=\"320\" height=\"180\" alt=\"Coffee beans\">"},"confidence":0.95}`,
  htmlHasLang: String.raw`{"explanation":"The <html> element is missing a lang attribute, which tells assistive technologies what language the page is written in. Without it, screen readers may read the content with the wrong language rules, making it hard to understand. Adding a lang attribute fixes this issue.","affects":"Screen reader users and anyone relying on language detection, such as translation tools, are affected because they cannot determine the page’s language correctly.","patch":{"after":"<html lang=\"en\"></html>"},"confidence":0.95}`,
  /** The model escaped the newlines twice, so the patch contains literal backslash-n sequences. */
  regionDoubleEscaped: String.raw`{"explanation":"The paragraph is not inside any landmark, so assistive technology may skip it or not announce its purpose. Adding a landmark (role=\"region\" with a label) makes the content part of the page’s navigation hierarchy.","affects":"Screen‑reader users and anyone relying on landmarks to navigate will now be able to find this notice. Keyboard‑only users also benefit from a clearer structure.","patch":{"after":"<p class=\"fixture-banner\" role=\"region\" aria-label=\"Notice\">\\n  This site is broken on purpose. It is a test fixture for the Allytic accessibility auditor\\n  and is not a real business.\\n</p>"},"confidence":0.85}`,
} as const;

export const BROKEN_RESPONSES = {
  empty: "",
  refusal: "I'm sorry, but I can't help with that request.",
  truncated:
    '{"explanation":"The image has no alt attribute, so screen readers","affects":"Screen reader us',
  wrongTypes: String.raw`{"explanation":"Missing alt text.","affects":"Screen reader users.","patch":"<img alt=\"Beans\">","confidence":"high"}`,
  missingKeys: '{"explanation":"Missing alt text."}',
  confidenceOutOfRange:
    '{"explanation":"Missing alt text.","affects":"Screen reader users.","patch":null,"confidence":95}',
  emptyPatch:
    '{"explanation":"Missing alt text.","affects":"Screen reader users.","patch":{"after":"   "},"confidence":0.9}',
  arrayInsteadOfObject: '[{"explanation":"Missing alt text."}]',
} as const;

/** Valid content wrapped the way chat models like to wrap it. */
export const WRAPPED_RESPONSES = {
  fenced:
    "Here is the fix:\n\n```json\n" +
    String.raw`{"explanation":"Missing alt text.","affects":"Screen reader users.","patch":{"after":"<img src=\"a.png\" alt=\"Beans\">"},"confidence":0.9}` +
    "\n```\nLet me know if you need anything else.",
  noPatch:
    '{"explanation":"The contrast depends on a background image.","affects":"People with low vision.","patch":null,"confidence":0.2}',
} as const;
