import {
  createOpenAiCompatibleProvider,
  type LlmProvider,
  PROVIDER_PRESETS,
  type ProviderName,
} from "@allytic/core";
import { UsageError } from "./errors.js";

export type Env = Readonly<Record<string, string | undefined>>;

/** Providers tried, in order, when `--provider` is not given. */
const AUTO_DETECT_ORDER: readonly ProviderName[] = ["groq", "openrouter"];

function keyFor(name: ProviderName, env: Env): string | null {
  const variable = PROVIDER_PRESETS[name].apiKeyEnv;
  return variable ? env[variable]?.trim() || null : null;
}

/** Builds the provider for `--fix` from the flags and the environment. Keys never come from flags. */
export function resolveProvider(
  requested: ProviderName | null,
  model: string | null,
  env: Env,
): LlmProvider {
  const name = requested ?? AUTO_DETECT_ORDER.find((candidate) => keyFor(candidate, env) !== null);
  if (!name) {
    throw new UsageError(
      "--fix needs a model provider. Set GROQ_API_KEY or OPENROUTER_API_KEY (in the environment or in a .env file), or use --provider ollama for a local model.",
    );
  }

  const preset = PROVIDER_PRESETS[name];
  const apiKey = keyFor(name, env);
  if (preset.apiKeyEnv && apiKey === null) {
    throw new UsageError(
      `--provider ${name} needs the ${preset.apiKeyEnv} environment variable (it can live in a .env file).`,
    );
  }

  return createOpenAiCompatibleProvider({
    name,
    baseURL: name === "ollama" ? env["OLLAMA_BASE_URL"]?.trim() || preset.baseURL : preset.baseURL,
    // Ollama ignores the key, but the client requires a non-empty one.
    apiKey: apiKey ?? "ollama",
    model: model ?? preset.defaultModel,
    // An explicit --model means "this model", so the preset's fallbacks do not apply.
    fallbackModels: model === null ? preset.fallbackModels : [],
    jsonMode: preset.jsonMode,
    extraBody: model === null ? preset.defaultModelBody : {},
  });
}
