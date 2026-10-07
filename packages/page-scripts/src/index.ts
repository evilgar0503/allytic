// Functions that run INSIDE the audited page: through `page.evaluate` in Playwright (CLI, API)
// or inside the sandboxed iframe of the web app.
//
// Each function is serialized with `toString()` and sent to the page on its own, so it must be
// fully self-contained: no imports, no references to anything declared outside its body, and
// a single JSON-serializable argument.

export interface SnapshotArgs {
  selector: string;
  /** Elements whose markup is longer than this are returned without their children. */
  maxLength: number;
}

export type SnapshotResult =
  | { found: false }
  | { found: true; html: string; childrenOmitted: boolean };

/** Reads the current markup of the single element matching `selector`. */
export function snapshotElement(args: SnapshotArgs): SnapshotResult {
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(args.selector);
  } catch {
    return { found: false };
  }
  const element = matches[0];
  if (matches.length !== 1 || !element) return { found: false };

  // The document's structural elements contain the whole page: never send them in full.
  const structural = ["HTML", "HEAD", "BODY"].includes(element.tagName);
  const full = element.outerHTML;
  if (!structural && full.length <= args.maxLength) {
    return { found: true, html: full, childrenOmitted: false };
  }

  const shell = element.cloneNode(false);
  return {
    found: true,
    html: shell instanceof Element ? shell.outerHTML : `<${element.tagName.toLowerCase()}>`,
    childrenOmitted: true,
  };
}

export interface ApplyPatchArgs {
  selector: string;
  /** Replacement markup proposed by the model. Untrusted. */
  after: string;
  /** True when `after` describes only the element itself and its children must be kept. */
  childrenOmitted: boolean;
  /** Attribute set on the patched element so that it can be found again. */
  marker: string;
  /** Name of the global under which the undo function is stored. */
  undoKey: string;
}

export type ApplyPatchResult = { ok: true } | { ok: false; reason: string };

/**
 * Replaces the element with the patch and remembers how to undo it.
 *
 * Markup is parsed in a `<template>` (inert: scripts in it never run) and only then moved
 * into the document. The page is an untrusted, throwaway browsing context either way.
 */
export function applyPatch(args: ApplyPatchArgs): ApplyPatchResult {
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(args.selector);
  } catch {
    return { ok: false, reason: "The selector of the element is not valid CSS." };
  }
  const element = matches[0];
  if (matches.length !== 1 || !element) {
    return { ok: false, reason: "The element could not be found in the page." };
  }

  const tag = element.tagName.toLowerCase();
  const structural = tag === "html" || tag === "head" || tag === "body";

  let replacement: Element;
  if (structural) {
    if (!new RegExp(`^\\s*<${tag}[\\s>]`, "i").test(args.after)) {
      return {
        ok: false,
        reason: `The <${tag}> element cannot be replaced by a different element.`,
      };
    }
    const parsed = new DOMParser().parseFromString(args.after, "text/html");
    replacement =
      tag === "html" ? parsed.documentElement : tag === "head" ? parsed.head : parsed.body;
  } else {
    const template = document.createElement("template");
    template.innerHTML = args.after;
    const roots = template.content.children;
    const strayText = Array.from(template.content.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
    );
    const root = roots[0];
    if (roots.length !== 1 || !root || strayText) {
      return { ok: false, reason: "patch.after must be exactly one root element." };
    }
    replacement = root;
  }

  let undo: () => void;

  if (structural || (args.childrenOmitted && replacement.tagName === element.tagName)) {
    // Same element, children untouched: only the attributes change.
    const original = Array.from(element.attributes).map((attribute) => ({
      name: attribute.name,
      value: attribute.value,
    }));
    for (const attribute of original) element.removeAttribute(attribute.name);
    for (const attribute of Array.from(replacement.attributes)) {
      element.setAttribute(attribute.name, attribute.value);
    }
    element.setAttribute(args.marker, "");
    undo = () => {
      for (const attribute of Array.from(element.attributes)) {
        element.removeAttribute(attribute.name);
      }
      for (const attribute of original) element.setAttribute(attribute.name, attribute.value);
    };
  } else if (args.childrenOmitted) {
    // The tag changed but the children were not part of the patch: carry them over.
    const moved = Array.from(element.childNodes);
    for (const child of moved) replacement.appendChild(child);
    element.replaceWith(replacement);
    replacement.setAttribute(args.marker, "");
    undo = () => {
      for (const child of moved) element.appendChild(child);
      replacement.replaceWith(element);
    };
  } else {
    element.replaceWith(replacement);
    replacement.setAttribute(args.marker, "");
    undo = () => {
      replacement.replaceWith(element);
    };
  }

  Reflect.set(window, args.undoKey, undo);
  return { ok: true };
}

export interface UndoPatchArgs {
  undoKey: string;
}

/** Restores the page to how it was before `applyPatch`. Returns false if there was nothing to undo. */
export function undoPatch(args: UndoPatchArgs): boolean {
  const undo: unknown = Reflect.get(window, args.undoKey);
  if (typeof undo !== "function") return false;
  undo();
  Reflect.deleteProperty(window, args.undoKey);
  return true;
}

export interface TargetStillFailsArgs {
  /** Selectors of the elements axe still reports for the rule, after the patch. */
  selectors: string[];
  marker: string;
}

/**
 * True when any of the reported elements is the patched element or lives inside it (a patch
 * may wrap the original element). Also true when the patched element cannot be found, so that
 * a doubt never counts as a pass.
 */
export function targetStillFails(args: TargetStillFailsArgs): boolean {
  const patched = document.querySelector(`[${args.marker}]`);
  if (!patched) return true;
  return args.selectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some((element) =>
        patched.contains(element),
      );
    } catch {
      return true;
    }
  });
}

export interface RunAxeArgs {
  /** axe rule tags to run, e.g. ["wcag2a", "wcag2aa"]. */
  tags: string[];
  /**
   * When true, only what is needed to judge a patch is returned (rule ids and selectors),
   * which keeps the message small for callers with a tight CPU budget.
   */
  lean: boolean;
  /** Longer snippets are cut inside the page, before they travel anywhere. */
  maxHtmlLength: number;
}

export interface CompactAxeNode {
  html: string;
  target: (string | string[])[];
  impact: string | null;
  failureSummary: string | null;
}

export interface CompactAxeRule {
  id: string;
  impact: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: CompactAxeNode[];
}

/** The subset of axe-core's output that Allytic reads, in the shape `core` validates. */
export interface CompactAxeResults {
  testEngine: { name: string; version: string };
  url: string;
  timestamp: string;
  violations: CompactAxeRule[];
  incomplete: CompactAxeRule[];
}

/**
 * Runs axe-core (which must already be loaded in the page as `window.axe`) and returns only
 * violations and undecided checks, already trimmed. Used where the full axe output would be
 * too expensive to send and parse: the API Worker and the web app's iframe.
 */
export async function runAxeInPage(args: RunAxeArgs): Promise<CompactAxeResults> {
  // `window.axe` is injected at runtime and has no type here; every value read from it is
  // converted explicitly below, and `core` validates the result again with zod.
  const axe = Reflect.get(window, "axe");
  if (!axe || typeof axe.run !== "function") {
    throw new Error("axe-core is not loaded in this page");
  }

  const results = await axe.run(document, {
    runOnly: { type: "tag", values: args.tags },
    resultTypes: ["violations", "incomplete"],
  });

  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const field = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

  const compactRules = (rules: unknown): CompactAxeRule[] =>
    list(rules).map((rule) => ({
      id: text(field(rule, "id")),
      impact: textOrNull(field(rule, "impact")),
      tags: args.lean ? [] : list(field(rule, "tags")).map(text),
      description: args.lean ? "" : text(field(rule, "description")),
      help: args.lean ? "" : text(field(rule, "help")),
      helpUrl: args.lean ? "" : text(field(rule, "helpUrl")),
      nodes: list(field(rule, "nodes")).map((node) => ({
        html: args.lean ? "" : text(field(node, "html")).slice(0, args.maxHtmlLength),
        target: list(field(node, "target")).map((part) =>
          Array.isArray(part) ? part.map(text) : text(part),
        ),
        impact: textOrNull(field(node, "impact")),
        failureSummary: args.lean ? null : textOrNull(field(node, "failureSummary")),
      })),
    }));

  return {
    testEngine: {
      name: text(field(field(results, "testEngine"), "name")),
      version: text(field(field(results, "testEngine"), "version")),
    },
    url: text(field(results, "url")),
    timestamp: text(field(results, "timestamp")),
    violations: compactRules(field(results, "violations")),
    incomplete: compactRules(field(results, "incomplete")),
  };
}
