import { launch } from "@cloudflare/playwright";
import axeSource from "axe-core/axe.min.js";
import type { Browser } from "playwright-core";
import type { Env } from "./env.js";
import { runSpike } from "./spike.js";
import { createDohResolver } from "./ssrf/resolver.js";

/** The only page the spike audits: our own deliberately broken fixture. */
const SPIKE_TARGET = "https://allytic-broken-site.pages.dev/";
const MAX_VERIFY_CYCLES = 12;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Constant-time comparison, so the token cannot be guessed one character at a time. */
function sameSecret(given: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index++) {
    difference |= (a[index % Math.max(a.length, 1)] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

async function handleSpike(request: Request, env: Env): Promise<Response> {
  // Without the secret the endpoint does not exist at all.
  if (!env.SPIKE_TOKEN) return json({ error: "not_found" }, 404);
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!sameSecret(given, env.SPIKE_TOKEN)) return json({ error: "not_found" }, 404);

  const params = new URL(request.url).searchParams;
  const guard = params.get("guard") !== "0";
  const verifyCycles = Math.min(
    Math.max(Number(params.get("verify") ?? "0") || 0, 0),
    MAX_VERIFY_CYCLES,
  );

  const started = Date.now();
  // The fork re-exports the Playwright API types through a path that NodeNext resolution cannot
  // follow, so the type is taken from playwright-core, whose API it implements.
  const browser: Browser = await launch(env.BROWSER);
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const result = await runSpike(page, {
      url: SPIKE_TARGET,
      axeSource,
      resolver: createDohResolver((input, init) => fetch(input, init)),
      guard,
      verifyCycles,
    });
    return json({ ok: true, guard, totalWallMs: Date.now() - started, ...result });
  } finally {
    await browser.close();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/health") {
      return json({ ok: true, service: "allytic-api", phase: "3b-spike" });
    }
    if (request.method === "POST" && pathname === "/spike") {
      try {
        return await handleSpike(request, env);
      } catch (error) {
        // Spike only: the message helps to read the experiment. The real API will map
        // errors to typed codes and never return raw messages.
        return json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          500,
        );
      }
    }
    return json({ error: "not_found" }, 404);
  },
};
