import { describe, expect, it } from "vitest";
import { BROKEN_RESPONSES, REAL_RESPONSES, WRAPPED_RESPONSES } from "../testing/llm-responses.js";
import { MAX_PATCH_LENGTH, parseSuggestion } from "./suggestion.js";

function parseOk(text: string) {
  const parsed = parseSuggestion(text);
  if (!parsed.ok) throw new Error(`expected a valid suggestion, got: ${parsed.problem}`);
  return parsed.value;
}

describe("parseSuggestion with real model answers", () => {
  it("reads a plain JSON answer", () => {
    const suggestion = parseOk(REAL_RESPONSES.imageAlt);
    expect(suggestion.patch?.after).toBe(
      '<img src="img/beans.svg" width="320" height="180" alt="Coffee beans">',
    );
    expect(suggestion.confidence).toBe(0.95);
    expect(suggestion.explanation).toMatch(/alt attribute/);
    expect(suggestion.affects).toMatch(/Screen reader users/);
  });

  it("reads a patch for a structural element", () => {
    expect(parseOk(REAL_RESPONSES.htmlHasLang).patch?.after).toBe('<html lang="en"></html>');
  });

  it("undoes newlines that the model escaped twice", () => {
    const after = parseOk(REAL_RESPONSES.regionDoubleEscaped).patch?.after ?? "";
    expect(after).not.toContain("\\n");
    expect(after.split("\n")).toHaveLength(4);
    expect(after).toMatch(
      /^<p class="fixture-banner" role="region" aria-label="Notice">\n {2}This site/,
    );
  });
});

describe("parseSuggestion with wrapped answers", () => {
  it("finds the JSON inside a code fence and surrounding prose", () => {
    expect(parseOk(WRAPPED_RESPONSES.fenced).patch?.after).toBe('<img src="a.png" alt="Beans">');
  });

  it("accepts an explanation without a patch", () => {
    expect(parseOk(WRAPPED_RESPONSES.noPatch).patch).toBeNull();
  });

  it("leaves real line breaks and legitimate backslashes alone", () => {
    const answer = JSON.stringify({
      explanation: "x",
      affects: "y",
      patch: { after: '<a href="#" title="C:\\new">a\nb</a>' },
      confidence: 0.5,
    });
    expect(parseOk(answer).patch?.after).toBe('<a href="#" title="C:\\new">a\nb</a>');
  });
});

describe("parseSuggestion with broken answers", () => {
  it.each([
    ["empty", /did not contain a JSON object/],
    ["refusal", /did not contain a JSON object/],
    ["truncated", /did not contain a JSON object|not valid JSON/],
    ["wrongTypes", /patch: .*; confidence: /],
    ["missingKeys", /affects: /],
    ["confidenceOutOfRange", /confidence: /],
    ["emptyPatch", /patch\.after: /],
    ["arrayInsteadOfObject", /affects: /],
  ] as const)("rejects the %s answer with a problem the model can act on", (name, problem) => {
    const parsed = parseSuggestion(BROKEN_RESPONSES[name]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toMatch(problem);
  });

  it("rejects patches that are too long to be a targeted fix", () => {
    const answer = JSON.stringify({
      explanation: "x",
      affects: "y",
      patch: { after: `<p>${"a".repeat(MAX_PATCH_LENGTH)}</p>` },
      confidence: 0.5,
    });
    expect(parseSuggestion(answer).ok).toBe(false);
  });

  it("ignores extra keys instead of failing on them", () => {
    const answer = JSON.stringify({
      explanation: "x",
      affects: "y",
      patch: { before: "<img>", after: '<img alt="">' },
      confidence: 1,
      wcagCriterion: "1.1.1",
    });
    expect(parseOk(answer)).toEqual({
      explanation: "x",
      affects: "y",
      patch: { after: '<img alt="">' },
      confidence: 1,
    });
  });
});
