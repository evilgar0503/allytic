import type { LlmRequest } from "./types.js";

/** Stores raw model answers. Implementations: memory (here), files (CLI), KV (API). */
export interface LlmCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export function createMemoryCache(): LlmCache {
  const entries = new Map<string, string>();
  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, value) {
      entries.set(key, value);
    },
  };
}

/**
 * SHA-256 of the model and the full prompt. The prompt already contains the rule, the
 * element's markup and any retry feedback, so two requests share a key only when the model
 * would be asked exactly the same thing.
 */
export async function cacheKey(model: string, request: LlmRequest): Promise<string> {
  // JSON-encoded so that the boundaries between the three parts are unambiguous.
  const input = new TextEncoder().encode(JSON.stringify([model, request.system, request.user]));
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
