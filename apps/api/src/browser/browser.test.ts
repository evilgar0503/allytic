import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { buildReport } from "@allytic/core";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runSpike } from "../spike.js";
import { createRequestGuard } from "../ssrf/guard.js";
import type { DnsResolver } from "../ssrf/resolver.js";
import { injectAxe, runAxe } from "./axe.js";
import { installRequestGuard } from "./guarded-page.js";

// The browser-side code of the API, run in a real local Chromium. The same code runs against
// Cloudflare's remote browser in production: both speak the same Playwright API.
//
// The local server plays several hosts. Chromium is told to send every *.example.org name to
// 127.0.0.1, while the guard's (fake) DNS says which of those names are public and which are
// internal. That way the tests can check what the guard lets through to "the network".

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

let server: Server;
let port: number;
let browser: Browser;
let page: Page;
/** "host path" of every request that actually reached the server. */
let received: string[] = [];

const resolver: DnsResolver = async (hostname) =>
  ({
    "public.example.org": ["93.184.216.34"],
    "cdn.example.org": ["151.101.1.1"],
    "internal.example.org": ["10.0.0.5"],
  })[hostname] ?? [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const host = (request.headers.host ?? "").split(":")[0];
    const path = request.url ?? "/";
    received.push(`${host} ${path}`);
    const origin = (name: string) => `http://${name}.example.org:${port}`;

    if (path === "/pixel.png") {
      response.writeHead(200, { "content-type": "image/png" }).end(PIXEL);
    } else if (path === "/style.css") {
      response.writeHead(200, { "content-type": "text/css" }).end("p { color: #aaa; }");
    } else if (path === "/to-internal") {
      response.writeHead(302, { location: `${origin("internal")}/secret` }).end();
    } else if (path === "/to-metadata") {
      response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    } else if (path.startsWith("/hop/")) {
      const remaining = Number(path.slice("/hop/".length));
      response.writeHead(302, { location: remaining > 0 ? `/hop/${remaining - 1}` : "/" }).end();
    } else if (path === "/with-internal-subresources") {
      response.writeHead(200, { "content-type": "text/html" }).end(
        `<!doctype html><html lang="en"><title>Sneaky</title><main><h1>Sneaky</h1>
         <img alt="ok" src="/pixel.png">
         <img alt="internal" src="${origin("internal")}/secret.png">
         <img alt="loopback" src="http://127.0.0.1:${port}/loopback.png">
         <img alt="redirected" src="/to-internal"></main></html>`,
      );
    } else {
      response.writeHead(200, { "content-type": "text/html" }).end(
        `<!doctype html><html><head><title>Fixture</title>
         <link rel="stylesheet" href="${origin("cdn")}/style.css"></head>
         <body><main><h1>Fixture</h1><p>Light text</p>
         <img src="/pixel.png"><button type="button"></button></main></body></html>`,
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  port = address.port;

  browser = await chromium.launch({ args: ["--host-resolver-rules=MAP *.example.org 127.0.0.1"] });
});

afterAll(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(async () => {
  await page.context().close();
});

async function guardedPage() {
  received = [];
  const context = await browser.newContext({ serviceWorkers: "block" });
  page = await context.newPage();
  const guard = createRequestGuard({ resolver, allowedPorts: new Set(["", String(port)]) });
  const log = await installRequestGuard(page, guard);
  return { log, guard };
}

const publicUrl = (path: string) => `http://public.example.org:${port}${path}`;

describe("installRequestGuard", () => {
  it("lets a public page and its public subresources load", async () => {
    const { log } = await guardedPage();
    await page.goto(publicUrl("/"));

    expect(log.blocked).toEqual([]);
    expect(log.navigationRejection).toBeNull();
    expect(received).toEqual([
      "public.example.org /",
      expect.stringMatching(/ \/(style\.css|pixel\.png)$/),
      expect.stringMatching(/ \/(style\.css|pixel\.png)$/),
    ]);
    expect(await page.evaluate(() => document.querySelector("img")?.naturalWidth)).toBe(1);
  });

  it("stops a redirect to an internal host before the request is sent", async () => {
    const { log } = await guardedPage();
    await expect(page.goto(publicUrl("/to-internal"))).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);

    expect(log.navigationRejection).toMatchObject({ reason: "address_not_public" });
    // The first hop reached the server; the internal one never did.
    expect(received).toEqual(["public.example.org /to-internal"]);
  });

  it("stops a redirect to the cloud metadata address", async () => {
    const { log } = await guardedPage();
    await expect(page.goto(publicUrl("/to-metadata"))).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);

    expect(log.navigationRejection).toMatchObject({ reason: "address_not_public" });
    expect(log.blocked.map((entry) => entry.url)).toEqual([
      "http://169.254.169.254/latest/meta-data/",
    ]);
  });

  it("follows three redirects and refuses the fourth", async () => {
    const allowed = await guardedPage();
    await page.goto(publicUrl("/hop/2"));
    expect(allowed.log.navigationRejection).toBeNull();
    expect(await page.title()).toBe("Fixture");
    await page.context().close();

    const refused = await guardedPage();
    await expect(page.goto(publicUrl("/hop/3"))).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(refused.log.navigationRejection).toMatchObject({ reason: "too_many_redirects" });
    expect(received).toEqual([
      "public.example.org /hop/3",
      "public.example.org /hop/2",
      "public.example.org /hop/1",
      "public.example.org /hop/0",
    ]);
  });

  it("blocks subresources that point at internal hosts, directly or through a redirect", async () => {
    const { log } = await guardedPage();
    await page.goto(publicUrl("/with-internal-subresources"));

    expect(log.navigationRejection).toBeNull();
    expect(
      log.blocked.map((entry) => `${entry.rejection.reason} ${new URL(entry.url).pathname}`).sort(),
    ).toEqual([
      "address_not_public /loopback.png",
      "address_not_public /secret",
      "address_not_public /secret.png",
    ]);
    // Nothing addressed to the internal host or to loopback reached the server.
    expect(received.filter((entry) => !entry.startsWith("public.example.org "))).toEqual([]);
    expect(received).toContain("public.example.org /pixel.png");
  });

  it("refuses a page on an internal address outright", async () => {
    const { log } = await guardedPage();
    await expect(page.goto(`http://127.0.0.1:${port}/`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(log.navigationRejection).toMatchObject({ reason: "address_not_public" });
    expect(received).toEqual([]);
  });
});

describe("runAxe", () => {
  it("returns compact results that core accepts, the same rules as the full run", async () => {
    await guardedPage();
    await page.goto(publicUrl("/"));
    await injectAxe(page, axeSource);

    const full = await runAxe(page, { lean: false });
    const report = buildReport({
      axeResults: full,
      tool: { name: "Allytic", version: "0.0.0" },
      target: { kind: "url", input: "x", title: null },
      now: new Date(0),
    });
    const rules = report.groups.map((group) => group.rule.id).sort();
    expect(rules).toEqual(["button-name", "color-contrast", "html-has-lang", "image-alt"]);
    expect(report.engine.name).toBe("axe-core");
    expect(report.groups[0]?.findings[0]?.html).not.toBe("");

    const lean = await runAxe(page, { lean: true });
    expect(lean.violations.map((rule) => rule.id).sort()).toEqual(rules);
    expect(lean.violations.every((rule) => rule.nodes.every((node) => node.html === ""))).toBe(
      true,
    );
    expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify(full).length / 2);
  });

  it("can be injected into a page with a strict Content-Security-Policy", async () => {
    received = [];
    const context = await browser.newContext();
    page = await context.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        headers: { "content-security-policy": "default-src 'none'; script-src 'none'" },
        body: '<!doctype html><html lang="en"><title>Strict</title><main><h1>Strict</h1><img src="x.png"></main></html>',
      }),
    );
    await page.goto("http://strict.example.org/");
    await injectAxe(page, axeSource);

    const results = await runAxe(page, { lean: true });
    expect(results.violations.map((rule) => rule.id)).toContain("image-alt");
  });
});

describe("runSpike", () => {
  it("audits through the guard and runs the verification cycles", async () => {
    received = [];
    const context = await browser.newContext({ serviceWorkers: "block" });
    page = await context.newPage();

    const result = await runSpike(page, {
      url: publicUrl("/"),
      axeSource,
      resolver,
      guard: true,
      verifyCycles: 3,
      allowedPorts: new Set([String(port)]),
    });

    expect(result).toMatchObject({
      findings: 4,
      groups: 4,
      requestsBlocked: 0,
      hostsResolved: 2,
      verifyCyclesRun: 3,
    });
    // The page, its stylesheet and its image, plus the image again each time a patch
    // re-inserts the element: those requests go through the guard too.
    expect(result.requestsSeen).toBeGreaterThanOrEqual(3);
    expect(Object.keys(result.wallMs).sort()).toEqual([
      "apply",
      "axe",
      "goto",
      "guard",
      "injectAxe",
      "locate",
      "snapshot",
      "undo",
      "verifyAxe",
    ]);
  });
});
