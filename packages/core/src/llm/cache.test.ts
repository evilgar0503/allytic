import { describe, expect, it } from "vitest";
import { cacheKey, createMemoryCache } from "./cache.js";

const request = { system: "s", user: "u", maxOutputTokens: 10 };

describe("cacheKey", () => {
  it("is a SHA-256 hex digest, stable for the same input", async () => {
    const key = await cacheKey("model-a", request);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey("model-a", { ...request })).toBe(key);
  });

  it("changes with the model, the instructions and the page content", async () => {
    const keys = await Promise.all([
      cacheKey("model-a", request),
      cacheKey("model-b", request),
      cacheKey("model-a", { ...request, system: "other" }),
      cacheKey("model-a", { ...request, user: "other" }),
    ]);
    expect(new Set(keys).size).toBe(4);
  });

  it("does not confuse where one part ends and the next begins", async () => {
    expect(await cacheKey("m", { ...request, system: "a\nb", user: "c" })).not.toBe(
      await cacheKey("m\na", { ...request, system: "b", user: "c" }),
    );
  });
});

describe("createMemoryCache", () => {
  it("returns null for a miss and the stored value for a hit", async () => {
    const cache = createMemoryCache();
    expect(await cache.get("k")).toBeNull();
    await cache.set("k", "value");
    expect(await cache.get("k")).toBe("value");
  });
});
