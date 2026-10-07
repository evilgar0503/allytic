export { type AxeResults, parseAxeResults } from "./axe-results.js";
export { AllyticError, InvalidAxeResultsError, InvalidReportError } from "./errors.js";
export {
  FILE_EXTENSIONS,
  type FormatOptions,
  formatHtml,
  formatJson,
  formatMarkdown,
  formatReport,
  formatSarif,
  formatText,
  isReportFormat,
  REPORT_FORMATS,
  type ReportFormat,
  type SarifOptions,
  summaryLine,
} from "./formatters/index.js";
export { groupFindings, htmlPattern } from "./group.js";
export { IMPACT_LEVELS, type Impact, isImpact, meetsImpactThreshold } from "./impact.js";
export { cacheKey, createMemoryCache, type LlmCache } from "./llm/cache.js";
export {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleOptions,
} from "./llm/openai-compatible.js";
export {
  isProviderName,
  PROVIDER_NAMES,
  PROVIDER_PRESETS,
  type ProviderName,
  type ProviderPreset,
} from "./llm/presets.js";
export {
  buildPrompt,
  MAX_PROMPT_HTML_LENGTH,
  PROMPT_VERSION,
  type PromptInput,
} from "./llm/prompt.js";
export {
  type LlmSuggestion,
  llmSuggestionSchema,
  MAX_PATCH_LENGTH,
  type ParsedSuggestion,
  parseSuggestion,
} from "./llm/suggestion.js";
export {
  LlmError,
  type LlmErrorKind,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from "./llm/types.js";
export { dedent, MAX_HTML_LENGTH, normalizeRuleResults, type RuleFindings } from "./normalize.js";
export { type BuildReportInput, buildReport, hasFindingsAtOrAbove } from "./report.js";
export {
  type AiSummary,
  type AuditReport,
  type AuditTarget,
  auditReportSchema,
  DISCLAIMER,
  type Finding,
  type FindingGroup,
  type Patch,
  parseAuditReport,
  REPORT_SCHEMA_VERSION,
  type ReportSummary,
  type Rule,
  STANDARD,
  type Suggestion,
  type VerificationStatus,
} from "./report-schema.js";
export {
  addSuggestions,
  DEFAULT_MAX_LLM_CALLS,
  MAX_ATTEMPTS_PER_GROUP,
  type SuggestOptions,
} from "./suggest.js";
export {
  baselineCounts,
  type ElementSnapshot,
  judgePatch,
  type PatchEnvironment,
  type PatchTrial,
  type PatchTrialInput,
  selectorsForRule,
  type Verdict,
} from "./verify.js";
export { type WcagLevel, type WcagMapping, wcagFromTags } from "./wcag.js";
