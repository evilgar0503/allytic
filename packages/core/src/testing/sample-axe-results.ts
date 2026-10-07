/** Hand-written axe-core output covering the shapes the normalizer has to deal with. */
export function sampleAxeResults() {
  return {
    testEngine: { name: "axe-core", version: "4.13.0" },
    testRunner: { name: "axe" },
    url: "https://example.test/shop",
    timestamp: "2026-10-07T10:00:00.000Z",
    passes: [{ id: "bypass", nodes: [] }],
    violations: [
      {
        id: "color-contrast",
        impact: "serious",
        tags: ["cat.color", "wcag2aa", "wcag143"],
        description: "Ensure the contrast between foreground and background colors is sufficient",
        help: "Elements must meet minimum color contrast ratio thresholds",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
        nodes: [
          {
            html: '<p class="muted">Open daily</p>',
            target: [".muted"],
            impact: "serious",
            failureSummary: "Fix any of the following:\n  Insufficient contrast of 2.3",
          },
        ],
      },
      {
        id: "image-alt",
        impact: "critical",
        tags: ["cat.text-alternatives", "wcag2a", "wcag111", "section508"],
        description: "Ensure <img> elements have alternative text",
        help: "Images must have alternative text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
        nodes: [
          {
            html: '<img src="a.png" width="10">',
            target: ["img:nth-child(1)"],
            impact: "critical",
            failureSummary: "Fix any of the following:\n  Element does not have an alt attribute",
          },
          {
            html: '<img width="20" src="b.png">',
            target: ["img:nth-child(2)"],
            impact: "critical",
            failureSummary: null,
          },
          {
            // Inside an iframe and a shadow root; markup tries to break out of every format.
            html: '<img src="x" class="hero" onerror="alert(1)" title="a|b `c` </code><script>alert(2)</script>">',
            target: ["iframe#shop", ["x-card", "img.hero"]],
            impact: "critical",
          },
        ],
      },
      {
        id: "heading-order",
        impact: "moderate",
        tags: ["cat.semantics", "best-practice"],
        description: "Ensure the order of headings is semantically correct",
        help: "Heading levels should only increase by one",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/heading-order",
        nodes: [{ html: "<h4>Fresh</h4>", target: ["h4"], impact: "moderate" }],
      },
      {
        // axe lists rules with no failing node in some configurations.
        id: "empty-rule",
        impact: null,
        tags: [],
        description: "",
        help: "",
        helpUrl: "",
        nodes: [],
      },
    ],
    incomplete: [
      {
        id: "duplicate-id-aria",
        impact: null,
        tags: ["cat.parsing", "wcag2a", "wcag412"],
        description: "Ensure every id attribute value used in ARIA and in labels is unique",
        help: "IDs used in ARIA and labels must be unique",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.13/duplicate-id-aria",
        nodes: [{ html: '<span id="pickup">Pickup</span>', target: ["#pickup"], impact: null }],
      },
    ],
    inapplicable: [],
  };
}
