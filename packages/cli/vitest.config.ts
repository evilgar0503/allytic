import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace packages from source so tests do not need a prior build.
  resolve: { conditions: ["@allytic/source"] },
  ssr: { resolve: { conditions: ["@allytic/source"] } },
  test: {
    // The e2e tests launch a real browser.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
