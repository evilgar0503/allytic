import { describe, expect, it } from "vitest";
import { createRequestGuard } from "./guard.js";
import type { DnsResolver } from "./resolver.js";

/** A resolver backed by a table; unknown names do not exist. Records the names looked up. */
function fakeDns(records: Record<string, string[] | Error | (() => string[])>) {
  const lookups: string[] = [];
  const resolver: DnsResolver = async (hostname) => {
    lookups.push(hostname);
    const entry = records[hostname];
    if (entry instanceof Error) throw entry;
    if (typeof entry === "function") return entry();
    return entry ?? [];
  };
  return { resolver, lookups };
}

const navigation = (url: string, redirectCount = 0) => ({ url, redirectCount, isNavigation: true });
const subresource = (url: string) => ({ url, redirectCount: 0, isNavigation: false });

describe("createRequestGuard", () => {
  it("allows a public page and its public subresources", async () => {
    const { resolver } = fakeDns({
      "example.com": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
      "cdn.example.net": ["151.101.1.1"],
    });
    const guard = createRequestGuard({ resolver });

    expect(await guard.check(navigation("https://example.com/"))).toEqual({ ok: true });
    expect(await guard.check(subresource("https://cdn.example.net/app.css"))).toEqual({ ok: true });
    expect(await guard.check(subresource("data:image/png;base64,AAAA"))).toEqual({ ok: true });
  });

  it("rejects a host name that resolves to a private address", async () => {
    const { resolver } = fakeDns({
      "internal.example.com": ["10.0.0.5"],
      "meta.example.com": ["169.254.169.254"],
      "six.example.com": ["fd00::1"],
      "loop.example.com": ["127.0.0.1"],
    });
    const guard = createRequestGuard({ resolver });

    for (const host of ["internal", "meta", "six", "loop"]) {
      expect(await guard.check(navigation(`https://${host}.example.com/`))).toMatchObject({
        ok: false,
        reason: "address_not_public",
      });
    }
  });

  it("rejects a host with one private address among public ones", async () => {
    // The multi-record form of DNS rebinding: the browser may pick any of them.
    const { resolver } = fakeDns({ "rebind.example.com": ["93.184.216.34", "127.0.0.1"] });
    const guard = createRequestGuard({ resolver });

    expect(await guard.check(navigation("https://rebind.example.com/"))).toMatchObject({
      ok: false,
      reason: "address_not_public",
    });
  });

  it("rejects a private address hidden in an IPv6 record", async () => {
    const { resolver } = fakeDns({ "v6.example.com": ["93.184.216.34", "::ffff:10.0.0.1"] });
    const guard = createRequestGuard({ resolver });

    expect(await guard.check(navigation("https://v6.example.com/"))).toMatchObject({
      ok: false,
      reason: "address_not_public",
    });
  });

  it("re-validates every redirect hop, so a public page cannot bounce to an internal one", async () => {
    const { resolver } = fakeDns({
      "public.example.com": ["93.184.216.34"],
      "evil-redirect.example.com": ["192.168.1.10"],
    });
    const guard = createRequestGuard({ resolver });

    expect(await guard.check(navigation("https://public.example.com/go"))).toEqual({ ok: true });
    // 302 Location: an internal IP literal.
    expect(
      await guard.check(navigation("http://169.254.169.254/latest/meta-data/", 1)),
    ).toMatchObject({ ok: false, reason: "address_not_public" });
    // 302 Location: a name that resolves internally.
    expect(await guard.check(navigation("https://evil-redirect.example.com/", 1))).toMatchObject({
      ok: false,
      reason: "address_not_public",
    });
    // 302 Location: another scheme.
    expect(await guard.check(navigation("file:///etc/passwd", 1))).toMatchObject({
      ok: false,
      reason: "scheme_not_allowed",
    });
  });

  it("stops after three redirects of the page", async () => {
    const { resolver } = fakeDns({ "example.com": ["93.184.216.34"] });
    const guard = createRequestGuard({ resolver });

    expect(await guard.check(navigation("https://example.com/3", 3))).toEqual({ ok: true });
    expect(await guard.check(navigation("https://example.com/4", 4))).toMatchObject({
      ok: false,
      reason: "too_many_redirects",
    });
    // The limit is about the page, not about a redirected image.
    expect(
      await guard.check({
        url: "https://example.com/i.png",
        redirectCount: 5,
        isNavigation: false,
      }),
    ).toEqual({ ok: true });
  });

  it("applies the same rules to subresources", async () => {
    const { resolver } = fakeDns({ "example.com": ["93.184.216.34"] });
    const guard = createRequestGuard({ resolver });

    for (const url of [
      "http://127.0.0.1:8080/admin",
      "http://[::1]/",
      "http://localhost/secret.png",
      "http://router.lan/status",
      "http://example.com:6379/",
    ]) {
      expect((await guard.check(subresource(url))).ok, url).toBe(false);
    }
  });

  it("rejects names that do not exist and lookups that fail, without details", async () => {
    const { resolver } = fakeDns({ "down.example.com": new Error("SERVFAIL from 10.1.2.3") });
    const guard = createRequestGuard({ resolver });

    expect(await guard.check(navigation("https://nope.example.com/"))).toEqual({
      ok: false,
      reason: "dns_no_records",
      message: "The host name does not exist.",
    });
    expect(await guard.check(navigation("https://down.example.com/"))).toEqual({
      ok: false,
      reason: "dns_failed",
      message: "The host name could not be looked up.",
    });
  });

  it("looks each host up once per audit and never looks up IP literals", async () => {
    const { resolver, lookups } = fakeDns({ "example.com": ["93.184.216.34"] });
    const guard = createRequestGuard({ resolver });

    await Promise.all([
      guard.check(navigation("https://example.com/")),
      guard.check(subresource("https://example.com/a.css")),
      guard.check(subresource("https://EXAMPLE.com/b.js")),
      guard.check(subresource("https://8.8.8.8/c.png")),
    ]);

    expect(lookups).toEqual(["example.com"]);
    expect(guard.hostCount).toBe(1);
  });

  it("pins the first verdict: a later DNS change is the documented residual risk", async () => {
    // Time-of-check DNS rebinding: public when we look, private afterwards. The guard cannot
    // see the second answer because the browser resolves on its own; this test documents
    // that the verdict is not re-evaluated rather than pretending the case is covered.
    let calls = 0;
    const { resolver } = fakeDns({
      "flip.example.com": () => (calls++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]),
    });
    const guard = createRequestGuard({ resolver });

    expect(await guard.check(navigation("https://flip.example.com/"))).toEqual({ ok: true });
    expect(await guard.check(subresource("https://flip.example.com/x"))).toEqual({ ok: true });
    expect(calls).toBe(1);

    // A new audit looks again and now refuses.
    const nextAudit = createRequestGuard({ resolver });
    expect(await nextAudit.check(navigation("https://flip.example.com/"))).toMatchObject({
      ok: false,
      reason: "address_not_public",
    });
  });

  it("caps the number of distinct hosts per audit", async () => {
    const { resolver, lookups } = fakeDns({
      "a.example.com": ["93.184.216.34"],
      "b.example.com": ["93.184.216.34"],
      "c.example.com": ["93.184.216.34"],
    });
    const guard = createRequestGuard({ resolver, maxHosts: 2 });

    expect((await guard.check(navigation("https://a.example.com/"))).ok).toBe(true);
    expect((await guard.check(subresource("https://b.example.com/x"))).ok).toBe(true);
    expect(await guard.check(subresource("https://c.example.com/x"))).toMatchObject({
      ok: false,
      reason: "too_many_hosts",
    });
    // Hosts already checked keep working.
    expect((await guard.check(subresource("https://a.example.com/y"))).ok).toBe(true);
    expect(lookups).toEqual(["a.example.com", "b.example.com"]);
  });
});
