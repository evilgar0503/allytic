import { createOpenAiCompatibleProvider, LlmError } from "@allytic/core";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "./errors.js";
import { resolveProvider } from "./provider.js";
import { type MockLlm, type MockLlmReply, serveMockLlm } from "./testing/mock-llm-server.js";

let server: MockLlm | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function providerAgainst(
  reply: MockLlmReply | ((index: number) => MockLlmReply),
  options: { fallbackModels?: string[]; jsonMode?: boolean; maxRetries?: number } = {},
) {
  server = await serveMockLlm((_request, index) =>
    typeof reply === "function" ? reply(index) : reply,
  );
  return createOpenAiCompatibleProvider({
    name: "mock",
    baseURL: server.baseURL,
    apiKey: "test-key",
    model: "main-model",
    maxRetries: options.maxRetries ?? 0,
    ...options,
  });
}

const request = { system: "You are a test.", user: '{"element":{}}', maxOutputTokens: 256 };

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof LlmError)) throw new Error(`expected an LlmError, got ${String(error)}`);
  return error;
}

describe("OpenAI-compatible provider over HTTP", () => {
  it("sends the prompt and returns text, model and token usage", async () => {
    const provider = await providerAgainst("hello");

    expect(await provider.complete(request)).toEqual({
      text: "hello",
      model: "main-model",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    expect(server?.requests[0]).toMatchObject({
      model: "main-model",
      system: "You are a test.",
      user: '{"element":{}}',
    });
    expect(server?.requests[0]?.body).toMatchObject({ max_tokens: 256, stream: false });
    expect(server?.requests[0]?.body).not.toHaveProperty("models");
    expect(server?.requests[0]?.body).not.toHaveProperty("response_format");
  });

  it("adds OpenRouter's fallback list and JSON mode only when configured", async () => {
    const provider = await providerAgainst("{}", {
      fallbackModels: ["second-model", "third-model"],
      jsonMode: true,
    });
    await provider.complete(request);

    expect(server?.requests[0]?.body).toMatchObject({
      models: ["main-model", "second-model", "third-model"],
      response_format: { type: "json_object" },
    });
  });

  it.each([
    [401, "auth", false],
    [403, "auth", false],
    [400, "bad_request", false],
    [429, "rate_limited", true],
    [503, "unavailable", true],
  ] as const)("maps HTTP %i to a %s error", async (status, kind, transient) => {
    const provider = await providerAgainst({ status, error: "nope" });
    const error = await failure(provider.complete(request));

    expect(error.kind).toBe(kind);
    expect(error.transient).toBe(transient);
    expect(error.message).toContain("mock");
    expect(server?.requests).toHaveLength(1);
  });

  it("retries rate limits with backoff before giving up", async () => {
    const provider = await providerAgainst(
      { status: 429, error: "slow down", headers: { "retry-after-ms": "1" } },
      { maxRetries: 2 },
    );
    const error = await failure(provider.complete(request));

    expect(error.kind).toBe("rate_limited");
    expect(server?.requests).toHaveLength(3);
  });

  it("recovers when a retry succeeds", async () => {
    const provider = await providerAgainst(
      (index) =>
        index === 0
          ? { status: 429, error: "slow down", headers: { "retry-after-ms": "1" } }
          : "second time lucky",
      { maxRetries: 2 },
    );
    expect((await provider.complete(request)).text).toBe("second time lucky");
  });

  it("reports an unreachable endpoint as unavailable", async () => {
    const provider = createOpenAiCompatibleProvider({
      name: "mock",
      baseURL: "http://127.0.0.1:9/v1",
      apiKey: "k",
      model: "m",
      maxRetries: 0,
    });
    expect((await failure(provider.complete(request))).kind).toBe("unavailable");
  });

  it("never puts the API key in an error message", async () => {
    const provider = await providerAgainst({ status: 401, error: "invalid key" });
    const error = await failure(provider.complete(request));
    expect(error.message).not.toContain("test-key");
  });
});

describe("resolveProvider", () => {
  it("picks the first provider that has a key", () => {
    expect(resolveProvider(null, null, { GROQ_API_KEY: "g", OPENROUTER_API_KEY: "o" }).name).toBe(
      "groq",
    );
    expect(resolveProvider(null, null, { OPENROUTER_API_KEY: "o" }).name).toBe("openrouter");
  });

  it("uses the preset model unless one is given", () => {
    expect(resolveProvider("groq", null, { GROQ_API_KEY: "g" }).model).toBe("openai/gpt-oss-120b");
    expect(resolveProvider("groq", "other-model", { GROQ_API_KEY: "g" }).model).toBe("other-model");
  });

  it("needs no key for a local Ollama", () => {
    expect(resolveProvider("ollama", null, {}).name).toBe("ollama");
  });

  it("explains how to configure a provider when none is available", () => {
    expect(() => resolveProvider(null, null, {})).toThrow(UsageError);
    expect(() => resolveProvider(null, null, { GROQ_API_KEY: "  " })).toThrow(
      /Set GROQ_API_KEY or OPENROUTER_API_KEY/,
    );
    expect(() => resolveProvider("openrouter", null, { GROQ_API_KEY: "g" })).toThrow(
      /needs the OPENROUTER_API_KEY environment variable/,
    );
  });
});
