export const PROVIDER_NAMES = ["groq", "openrouter", "ollama"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export function isProviderName(value: unknown): value is ProviderName {
  // Widening cast only: Array.includes on a tuple of literals rejects a plain string.
  return typeof value === "string" && (PROVIDER_NAMES as readonly string[]).includes(value);
}

export interface ProviderPreset {
  baseURL: string;
  defaultModel: string;
  fallbackModels: readonly string[];
  jsonMode: boolean;
  /** Extra request fields that only apply to the preset's default model. */
  defaultModelBody: Readonly<Record<string, unknown>>;
  /** Environment variable holding the key, or null when the provider needs none. */
  apiKeyEnv: string | null;
}

/**
 * Free-tier defaults, checked on 2026-10-07. Free model line-ups change often: when a default
 * disappears, pick another with `--model` and update this table.
 */
export const PROVIDER_PRESETS: Record<ProviderName, ProviderPreset> = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    fallbackModels: [],
    jsonMode: true,
    // gpt-oss is a reasoning model: at the default effort it spends most of its output tokens
    // thinking, which exhausts the free tier's 8,000 tokens per minute after a few calls.
    defaultModelBody: { reasoning_effort: "low" },
    apiKeyEnv: "GROQ_API_KEY",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemma-4-31b-it:free",
    fallbackModels: ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-26b-a4b-it:free"],
    // Not every free model accepts response_format; the parser copes with fenced JSON instead.
    jsonMode: false,
    defaultModelBody: {},
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  ollama: {
    baseURL: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    fallbackModels: [],
    jsonMode: true,
    defaultModelBody: {},
    apiKeyEnv: null,
  },
};
