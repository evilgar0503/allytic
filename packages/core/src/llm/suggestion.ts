import { z } from "zod";

/** A patch longer than this is not a targeted fix; it is rejected and retried. */
export const MAX_PATCH_LENGTH = 4000;

/**
 * What the model must return. The WCAG criterion and the impact are deliberately not asked
 * for: axe already provides them and a model would only add a chance to get them wrong.
 */
export const llmSuggestionSchema = z.object({
  /** What is wrong and why it matters, in plain language. */
  explanation: z.string().trim().min(1).max(1500),
  /** Who is affected and how. */
  affects: z.string().trim().min(1).max(800),
  /** Replacement markup for the element, or null when no code change can fix it. */
  patch: z.object({ after: z.string().trim().min(1).max(MAX_PATCH_LENGTH) }).nullable(),
  /** The model's own estimate that the patch fixes the rule, from 0 to 1. */
  confidence: z.number().min(0).max(1),
});

export type LlmSuggestion = z.infer<typeof llmSuggestionSchema>;

export type ParsedSuggestion = { ok: true; value: LlmSuggestion } | { ok: false; problem: string };

/** Models often wrap JSON in a code fence or add a sentence around it. */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end <= start ? null : text.slice(start, end + 1);
}

/**
 * Some models escape the markup twice, leaving a literal backslash followed by "n" where a
 * line break was meant. When the text has no real line break but does have such sequences,
 * they are undone. Real markup practically never contains them.
 */
function unescapeTwice(markup: string): string {
  if (markup.includes("\n") || !/\\[nt"]/.test(markup)) return markup;
  return markup.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
}

/**
 * Validates a model answer. Never throws: a broken answer is an expected outcome, and
 * `problem` is written so that it can be sent back to the model on the retry.
 */
export function parseSuggestion(text: string): ParsedSuggestion {
  const json = extractJson(text);
  if (json === null) return { ok: false, problem: "The answer did not contain a JSON object." };

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, problem: `The answer was not valid JSON: ${reason}` };
  }

  const parsed = llmSuggestionSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, problem: `The JSON did not match the required shape: ${issues}` };
  }
  const { patch } = parsed.data;
  return {
    ok: true,
    value: { ...parsed.data, patch: patch ? { after: unescapeTwice(patch.after) } : null },
  };
}
