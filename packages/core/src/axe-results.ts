import { z } from "zod";
import { InvalidAxeResultsError } from "./errors.js";

// Only the parts of the axe-core result that Allytic reads. Unknown keys are ignored so that
// newer axe versions keep working. Kept as a schema (not axe's own types) because `core` must
// not depend on the DOM typings that axe-core pulls in.

/** A selector is a string, or an array of strings when it crosses shadow DOM boundaries. */
const targetPartSchema = z.union([z.string(), z.array(z.string())]);

const axeNodeSchema = z.object({
  html: z.string(),
  target: z.array(targetPartSchema),
  impact: z.string().nullish(),
  failureSummary: z.string().nullish(),
});

const axeRuleResultSchema = z.object({
  id: z.string().min(1),
  impact: z.string().nullish(),
  tags: z.array(z.string()),
  description: z.string(),
  help: z.string(),
  helpUrl: z.string(),
  nodes: z.array(axeNodeSchema),
});

export const axeResultsSchema = z.object({
  testEngine: z.object({ name: z.string(), version: z.string() }),
  url: z.string(),
  timestamp: z.string(),
  violations: z.array(axeRuleResultSchema),
  incomplete: z.array(axeRuleResultSchema).default([]),
});

export type AxeNode = z.infer<typeof axeNodeSchema>;
export type AxeRuleResult = z.infer<typeof axeRuleResultSchema>;
export type AxeResults = z.infer<typeof axeResultsSchema>;

export function parseAxeResults(input: unknown): AxeResults {
  const parsed = axeResultsSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidAxeResultsError(
      `Unexpected axe-core output: ${z.prettifyError(parsed.error)}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
