import { cacheKey, type LlmCache } from "./llm/cache.js";
import { buildPrompt, MAX_PROMPT_HTML_LENGTH } from "./llm/prompt.js";
import { type LlmSuggestion, parseSuggestion } from "./llm/suggestion.js";
import { LlmError, type LlmProvider } from "./llm/types.js";
import type { AiSummary, AuditReport, FindingGroup, Patch, Suggestion } from "./report-schema.js";
import { baselineCounts, judgePatch, type PatchEnvironment, type RuleCounts } from "./verify.js";

/** One answer plus one retry, whether the first one was malformed or failed verification. */
export const MAX_ATTEMPTS_PER_GROUP = 2;
export const DEFAULT_MAX_LLM_CALLS = 20;

export interface SuggestOptions {
  provider: LlmProvider;
  /** Null disables caching. */
  cache: LlmCache | null;
  /** Null when there is no live page: suggestions are still written, patches stay unverified. */
  environment: PatchEnvironment | null;
  /** Upper bound of model calls for the whole audit; cache hits do not count. */
  maxLlmCalls: number;
  onProgress?: (event: { done: number; total: number; ruleId: string }) => void;
}

interface Counters {
  llmCalls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
}

type Answer = { text: string; model: string } | { budgetExhausted: true };

async function ask(
  options: SuggestOptions,
  counters: Counters,
  request: ReturnType<typeof buildPrompt>,
): Promise<Answer> {
  const key = options.cache ? await cacheKey(options.provider.model, request) : null;
  if (options.cache && key) {
    const cached = await options.cache.get(key);
    if (cached !== null) {
      counters.cacheHits++;
      return { text: cached, model: options.provider.model };
    }
  }

  if (counters.llmCalls >= options.maxLlmCalls) return { budgetExhausted: true };
  counters.llmCalls++;
  const response = await options.provider.complete(request);
  counters.inputTokens += response.usage?.inputTokens ?? 0;
  counters.outputTokens += response.usage?.outputTokens ?? 0;

  // Only answers that parse are worth keeping; a broken one must not be replayed forever.
  if (options.cache && key && parseSuggestion(response.text).ok) {
    await options.cache.set(key, response.text);
  }
  return { text: response.text, model: response.model };
}

function unverifiablePatch(
  selector: string,
  before: string,
  childrenOmitted: boolean,
  after: string,
  detail: string,
  attempts: number,
): Patch {
  return {
    selector,
    before,
    after,
    childrenOmitted,
    verification: { status: "not-verifiable", detail, attempts },
  };
}

type GroupOutcome = { suggestion: Suggestion | null; budgetExhausted: boolean };

async function suggestForGroup(
  group: FindingGroup,
  report: AuditReport,
  baseline: RuleCounts,
  options: SuggestOptions,
  counters: Counters,
): Promise<GroupOutcome> {
  const finding = group.findings[0];
  if (!finding) return { suggestion: null, budgetExhausted: false };

  const live =
    options.environment && finding.scope === "page"
      ? await options.environment.snapshot(finding.selector)
      : null;
  // Without a live element the stored snippet is all there is; it may be cut, so the model
  // is told not to rely on the children.
  const element = live ?? {
    html: finding.html,
    childrenOmitted: finding.htmlTruncated || finding.html.length > MAX_PROMPT_HTML_LENGTH,
  };
  const whyUnverifiable = !options.environment
    ? "No live page was available to try the patch."
    : finding.scope !== "page"
      ? "The element is inside a frame or shadow root, where patches cannot be tried yet."
      : "The element could not be found again in the page.";

  let feedback: { previousAfter: string | null; problem: string } | undefined;
  let lastTried: { parsed: LlmSuggestion; model: string; detail: string | null } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_GROUP; attempt++) {
    const answer = await ask(
      options,
      counters,
      buildPrompt({
        rule: group.rule,
        html: element.html,
        childrenOmitted: element.childrenOmitted,
        failureSummary: finding.failureSummary,
        pageTitle: report.target.title,
        ...(feedback ? { feedback } : {}),
      }),
    );
    if ("budgetExhausted" in answer) {
      return {
        suggestion: toSuggestion(lastTried, finding.selector, element, attempt - 1),
        budgetExhausted: true,
      };
    }

    const parsed = parseSuggestion(answer.text);
    if (!parsed.ok) {
      feedback = { previousAfter: null, problem: parsed.problem };
      continue;
    }

    const base = {
      model: answer.model,
      explanation: parsed.value.explanation,
      affects: parsed.value.affects,
      confidence: parsed.value.confidence,
    };
    if (parsed.value.patch === null) {
      return { suggestion: { ...base, patch: null }, budgetExhausted: false };
    }
    const { after } = parsed.value.patch;

    if (!live || !options.environment) {
      return {
        suggestion: {
          ...base,
          patch: unverifiablePatch(
            finding.selector,
            element.html,
            element.childrenOmitted,
            after,
            whyUnverifiable,
            attempt,
          ),
        },
        budgetExhausted: false,
      };
    }

    const trial = await options.environment.tryPatch({
      selector: finding.selector,
      ruleId: group.rule.id,
      after,
      childrenOmitted: element.childrenOmitted,
    });
    const verdict = judgePatch(trial, group.rule.id, baseline);
    if (verdict.status === "verified") {
      return {
        suggestion: {
          ...base,
          patch: {
            selector: finding.selector,
            before: element.html,
            after,
            childrenOmitted: element.childrenOmitted,
            verification: { status: "verified", detail: null, attempts: attempt },
          },
        },
        budgetExhausted: false,
      };
    }

    lastTried = { parsed: parsed.value, model: answer.model, detail: verdict.detail };
    feedback = { previousAfter: after, problem: verdict.detail ?? "The patch was not verified." };
  }

  return {
    suggestion: toSuggestion(lastTried, finding.selector, element, MAX_ATTEMPTS_PER_GROUP),
    budgetExhausted: false,
  };
}

/** The last patch that was tried and failed is still shown, clearly marked as not verified. */
function toSuggestion(
  lastTried: { parsed: LlmSuggestion; model: string; detail: string | null } | null,
  selector: string,
  element: { html: string; childrenOmitted: boolean },
  attempts: number,
): Suggestion | null {
  if (!lastTried?.parsed.patch) return null;
  return {
    model: lastTried.model,
    explanation: lastTried.parsed.explanation,
    affects: lastTried.parsed.affects,
    confidence: lastTried.parsed.confidence,
    patch: {
      selector,
      before: element.html,
      after: lastTried.parsed.patch.after,
      childrenOmitted: element.childrenOmitted,
      verification: { status: "failed", detail: lastTried.detail, attempts: Math.max(1, attempts) },
    },
  };
}

/**
 * Adds an AI explanation and, where possible, a verified patch to every group of the report.
 *
 * Degrades instead of failing: a malformed answer is retried once and then dropped (the group
 * keeps axe's own description), and a transient provider error stops further calls but keeps
 * what was already obtained. Only configuration errors (bad key, bad request) are thrown.
 */
export async function addSuggestions(
  report: AuditReport,
  options: SuggestOptions,
): Promise<AuditReport> {
  const counters: Counters = { llmCalls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 };
  const baseline = baselineCounts(report);
  const groups: FindingGroup[] = [];
  let stoppedEarly: string | null = null;

  for (const [index, group] of report.groups.entries()) {
    if (stoppedEarly !== null) {
      groups.push(group);
      continue;
    }
    options.onProgress?.({ done: index, total: report.groups.length, ruleId: group.rule.id });

    try {
      const outcome = await suggestForGroup(group, report, baseline, options, counters);
      groups.push({ ...group, suggestion: outcome.suggestion });
      if (outcome.budgetExhausted) {
        stoppedEarly = `The limit of ${options.maxLlmCalls} model calls was reached.`;
      }
    } catch (error) {
      if (error instanceof LlmError && error.transient) {
        stoppedEarly = error.message;
        groups.push(group);
        continue;
      }
      throw error;
    }
  }

  const suggestions = groups.filter((group) => group.suggestion !== null).length;
  const ai: AiSummary = {
    provider: options.provider.name,
    model: options.provider.model,
    ...counters,
    suggestions,
    verifiedPatches: groups.filter(
      (group) => group.suggestion?.patch?.verification.status === "verified",
    ).length,
    skippedGroups: groups.length - suggestions,
    stoppedEarly,
  };

  return { ...report, groups, ai };
}
