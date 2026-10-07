import OpenAI, { type ClientOptions } from "openai";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

export interface OpenAiCompatibleOptions {
  /** Shown in reports and error messages, e.g. "groq". */
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** OpenRouter only: models tried in order when the main one is unavailable (at most 3 in total). */
  fallbackModels?: readonly string[];
  /** Ask for `response_format: json_object`. Not every free model supports it. */
  jsonMode?: boolean;
  /** Provider-specific request fields, sent as they are. */
  extraBody?: Readonly<Record<string, unknown>>;
  timeoutMs?: number;
  /** Retries for 429, 5xx and network errors, with exponential backoff honouring Retry-After. */
  maxRetries?: number;
  /** Injectable for tests. */
  fetch?: ClientOptions["fetch"];
  /** Required to call a provider straight from a browser with the user's own key (BYOK). */
  allowBrowser?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
/** Low but not zero: deterministic enough to cache, and a retry can still differ. */
const TEMPERATURE = 0.2;

function toLlmError(name: string, error: unknown): LlmError {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new LlmError("timeout", `${name} did not answer in time.`, { cause: error });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new LlmError("unavailable", `Could not reach ${name}: ${error.message}`, {
      cause: error,
    });
  }
  if (error instanceof OpenAI.APIError) {
    // Provider messages can name the account (organization ids, quotas). Messages of transient
    // errors end up in reports, so they stay generic; the original is kept as `cause`.
    if (error.status === 401 || error.status === 403) {
      return new LlmError("auth", `${name} rejected the API key (HTTP ${error.status}).`, {
        cause: error,
      });
    }
    if (error.status === 429) {
      return new LlmError("rate_limited", `${name} rate limit reached (HTTP 429).`, {
        cause: error,
      });
    }
    if (error.status !== undefined && error.status >= 500) {
      return new LlmError("unavailable", `${name} failed with HTTP ${error.status}.`, {
        cause: error,
      });
    }
    return new LlmError("bad_request", `${name} rejected the request: ${error.message}`, {
      cause: error,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new LlmError("unavailable", `Unexpected error calling ${name}: ${reason}`, {
    cause: error,
  });
}

/** Provider for any endpoint that speaks the OpenAI chat completions API (Groq, OpenRouter, Ollama). */
export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    dangerouslyAllowBrowser: options.allowBrowser ?? false,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  // `models` is an OpenRouter extension to the request body; other providers never receive it.
  const extraBody: Record<string, unknown> = {
    ...options.extraBody,
    ...(options.fallbackModels && options.fallbackModels.length > 0
      ? { models: [options.model, ...options.fallbackModels] }
      : {}),
  };

  return {
    name: options.name,
    model: options.model,

    async complete(request: LlmRequest): Promise<LlmResponse> {
      try {
        const completion = await client.chat.completions.create({
          ...extraBody,
          model: options.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: TEMPERATURE,
          max_tokens: request.maxOutputTokens,
          stream: false,
          ...(options.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
        });

        return {
          text: completion.choices[0]?.message.content ?? "",
          model: completion.model,
          usage: completion.usage
            ? {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
              }
            : null,
        };
      } catch (error) {
        throw toLlmError(options.name, error);
      }
    },
  };
}
