import { baselineCounts, buildReport, judgePatch, type PatchEnvironment } from "@allytic/core";
import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPlaywrightEnvironment } from "./patch-environment.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

afterEach(async () => {
  await page.context().close();
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** Loads a page and returns an environment plus what the checks need to judge a patch. */
async function open(body: string, htmlAttributes = 'lang="en"') {
  const context = await browser.newContext();
  page = await context.newPage();
  await page.setContent(
    `<!doctype html><html ${htmlAttributes}><head><title>Test page</title></head><body><main>${body}</main></body></html>`,
  );
  const runAxe = (): Promise<unknown> => new AxeBuilder({ page }).withTags(TAGS).analyze();
  const report = buildReport({
    axeResults: await runAxe(),
    tool: { name: "Allytic", version: "0.0.0" },
    target: { kind: "url", input: "test", title: null },
    now: new Date(0),
  });
  const environment: PatchEnvironment = createPlaywrightEnvironment(page, runAxe);
  const markup = () => page.evaluate(() => document.documentElement.outerHTML);
  return { environment, baseline: baselineCounts(report), markup, report };
}

describe("snapshot", () => {
  it("returns the full markup of a small element", async () => {
    const { environment } = await open('<img src="a.png" width="10">');
    expect(await environment.snapshot("img")).toEqual({
      html: '<img src="a.png" width="10">',
      childrenOmitted: false,
    });
  });

  it("returns only the element itself when it is large", async () => {
    const items = Array.from({ length: 200 }, (_, index) => `<li>Item number ${index}</li>`).join(
      "",
    );
    const { environment } = await open(`<ul class="menu" id="big">${items}</ul>`);
    expect(await environment.snapshot("#big")).toEqual({
      html: '<ul class="menu" id="big"></ul>',
      childrenOmitted: true,
    });
  });

  it("never returns the whole document for structural elements", async () => {
    const { environment } = await open("<p>Hello</p>", 'lang="en" class="no-js"');
    expect(await environment.snapshot("html")).toEqual({
      html: '<html lang="en" class="no-js"></html>',
      childrenOmitted: true,
    });
  });

  it("returns null when the selector matches nothing, several elements, or is invalid", async () => {
    const { environment } = await open("<p>a</p><p>b</p>");
    expect(await environment.snapshot("img")).toBeNull();
    expect(await environment.snapshot("p")).toBeNull();
    expect(await environment.snapshot("p >>> span")).toBeNull();
  });
});

describe("tryPatch", () => {
  it("verifies a patch that fixes the rule, and leaves the page exactly as it was", async () => {
    const { environment, baseline, markup } = await open('<img src="a.png" width="10">');
    const before = await markup();

    const trial = await environment.tryPatch({
      selector: "img",
      ruleId: "image-alt",
      after: '<img src="a.png" width="10" alt="Coffee beans">',
      childrenOmitted: false,
    });

    expect(judgePatch(trial, "image-alt", baseline)).toEqual({ status: "verified", detail: null });
    expect(await markup()).toBe(before);
  });

  it("rejects a patch that leaves the rule failing", async () => {
    const { environment, baseline, markup } = await open('<img src="a.png">');
    const before = await markup();

    const trial = await environment.tryPatch({
      selector: "img",
      ruleId: "image-alt",
      after: '<img src="a.png" class="decorative">',
      childrenOmitted: false,
    });

    expect(judgePatch(trial, "image-alt", baseline).detail).toMatch(/still reports "image-alt"/);
    expect(await markup()).toBe(before);
  });

  it("rejects a patch that fixes the rule by breaking another one", async () => {
    const { environment, baseline } = await open('<img src="a.png">');

    const trial = await environment.tryPatch({
      selector: "img",
      ruleId: "image-alt",
      after: '<img src="a.png" alt="Beans" role="imge">',
      childrenOmitted: false,
    });

    expect(judgePatch(trial, "image-alt", baseline)).toEqual({
      status: "failed",
      detail: "The patch introduced new axe-core violations: aria-roles.",
    });
  });

  it("still finds the element when the patch wraps it", async () => {
    const { environment, baseline, markup } = await open('<input type="text" name="q">');
    const before = await markup();

    const wrapped = await environment.tryPatch({
      selector: "input",
      ruleId: "label",
      after: '<label>Search <input type="text" name="q"></label>',
      childrenOmitted: false,
    });
    expect(judgePatch(wrapped, "label", baseline).status).toBe("verified");

    // A wrapper that does not name the input must not pass just because the tag changed.
    const useless = await environment.tryPatch({
      selector: "input",
      ruleId: "label",
      after: '<div><input type="text" name="q"></div>',
      childrenOmitted: false,
    });
    expect(judgePatch(useless, "label", baseline).status).toBe("failed");
    expect(await markup()).toBe(before);
  });

  it("changes only the attributes of a structural element", async () => {
    const { environment, baseline, markup } = await open("<p>Hello</p>", "");
    const before = await markup();

    const trial = await environment.tryPatch({
      selector: "html",
      ruleId: "html-has-lang",
      after: '<html lang="en"></html>',
      childrenOmitted: true,
    });

    expect(judgePatch(trial, "html-has-lang", baseline).status).toBe("verified");
    expect(await markup()).toBe(before);
    expect(before).not.toContain("lang=");
  });

  it("keeps the children when the tag changes and they were omitted", async () => {
    const { baseline, markup } = await open(
      '<div role="buton" tabindex="0" id="promo"><span>Apply</span> <b>promo code</b></div>',
    );
    const before = await markup();
    // The axe run happens while the patch is in place: use it to look at the patched page.
    let during = "";
    const observed = createPlaywrightEnvironment(page, async () => {
      during = await page.evaluate(() => document.querySelector("#promo")?.outerHTML ?? "");
      return new AxeBuilder({ page }).withTags(TAGS).analyze();
    });

    const trial = await observed.tryPatch({
      selector: "#promo",
      ruleId: "aria-roles",
      after: '<button type="button" id="promo"></button>',
      childrenOmitted: true,
    });

    expect(during).toContain('<button type="button" id="promo"');
    expect(during).toContain("<span>Apply</span> <b>promo code</b></button>");
    expect(judgePatch(trial, "aria-roles", baseline).status).toBe("verified");
    expect(await markup()).toBe(before);
  });

  it.each([
    ["two root elements", "<p>a</p><p>b</p>"],
    ["text outside the element", 'Use this: <img alt="x">'],
    ["no element at all", "just add an alt attribute"],
  ])("refuses a patch with %s", async (_name, after) => {
    const { environment, baseline, markup } = await open('<img src="a.png">');
    const before = await markup();

    const trial = await environment.tryPatch({
      selector: "img",
      ruleId: "image-alt",
      after,
      childrenOmitted: false,
    });

    expect(trial).toEqual({
      applied: false,
      reason: "patch.after must be exactly one root element.",
    });
    expect(judgePatch(trial, "image-alt", baseline).status).toBe("failed");
    expect(await markup()).toBe(before);
  });

  it("refuses to replace a structural element with something else", async () => {
    const { environment } = await open("<p>Hello</p>", "");
    expect(
      await environment.tryPatch({
        selector: "html",
        ruleId: "html-has-lang",
        after: '<div lang="en"></div>',
        childrenOmitted: true,
      }),
    ).toEqual({
      applied: false,
      reason: "The <html> element cannot be replaced by a different element.",
    });
  });

  it("does not run scripts that come inside a patch", async () => {
    const { environment } = await open('<img src="a.png">');

    const trial = await environment.tryPatch({
      selector: "img",
      ruleId: "image-alt",
      after: '<span><script>window.allyticPwned = true</script><img src="a.png" alt="x"></span>',
      childrenOmitted: false,
    });

    expect(trial.applied).toBe(true);
    expect(await page.evaluate(() => "allyticPwned" in window)).toBe(false);
  });

  it("reports an element that disappeared instead of throwing", async () => {
    const { environment } = await open('<img src="a.png">');
    expect(
      await environment.tryPatch({
        selector: "img.gone",
        ruleId: "image-alt",
        after: '<img alt="x">',
        childrenOmitted: false,
      }),
    ).toEqual({ applied: false, reason: "The element could not be found in the page." });
  });
});
