import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LlmCache } from "@allytic/core";

export const CACHE_DIRECTORY = join(".allytic", "cache");

/**
 * Keeps model answers on disk, one file per key, so that auditing the same page again costs
 * no model calls. A cache that cannot be read or written is simply a miss: it must never be
 * the reason an audit fails.
 */
export function createFileCache(directory: string): LlmCache {
  // Keys are SHA-256 hex digests; anything else is refused rather than used as a file name.
  const pathFor = (key: string) =>
    /^[0-9a-f]{64}$/.test(key) ? join(directory, `${key}.txt`) : null;

  return {
    async get(key) {
      const path = pathFor(key);
      if (!path) return null;
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const path = pathFor(key);
      if (!path) return;
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(path, value, "utf8");
      } catch {
        // Read-only directory, full disk…: the audit continues without caching.
      }
    },
  };
}
