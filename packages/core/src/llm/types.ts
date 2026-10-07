import { AllyticError } from "../errors.js";

export interface LlmRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  text: string;
  /** Model that actually answered; differs from the requested one when a fallback was used. */
  model: string;
  usage: LlmUsage | null;
}

/** Anything that can turn a prompt into text: an OpenAI-compatible API, Workers AI, a test fake. */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * - `auth`, `bad_request`: retrying cannot help; the configuration is wrong.
 * - `rate_limited`, `timeout`, `unavailable`: transient, already retried with backoff.
 */
export type LlmErrorKind = "auth" | "bad_request" | "rate_limited" | "timeout" | "unavailable";

export class LlmError extends AllyticError {
  readonly code = "LLM_ERROR";

  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  get transient(): boolean {
    return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "unavailable";
  }
}
