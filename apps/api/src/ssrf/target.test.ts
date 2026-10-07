import { describe, expect, it } from "vitest";
import { checkUrl, MAX_URL_LENGTH } from "./target.js";

function reasonFor(input: string) {
  const result = checkUrl(input);
  return result.ok ? "accepted" : result.reason;
}

describe("checkUrl", () => {
  it("accepts ordinary public URLs and normalizes the host", () => {
    const result = checkUrl("HTTPS://Example.COM./path?q=1#frag");
    expect(result).toMatchObject({ ok: true, hostname: "example.com", isAddress: false });
    expect(reasonFor("http://example.com:8080/")).toBe("accepted");
    expect(reasonFor("https://sub.domain.example.org/")).toBe("accepted");
    expect(reasonFor("https://8.8.8.8/")).toBe("accepted");
    expect(reasonFor("https://[2606:4700:4700::1111]/")).toBe("accepted");
  });

  it.each([
    "ftp://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "gopher://example.com/",
    "ws://example.com/",
    "chrome://settings",
    "view-source:https://example.com",
  ])("rejects the scheme of %s", (input) => {
    expect(reasonFor(input)).toBe("scheme_not_allowed");
  });

  it.each(["", "example.com", "//example.com", "http://", "http://exa mple.com", "http://[::1"])(
    "rejects %j as not a URL",
    (input) => {
      expect(reasonFor(input)).toBe("invalid_url");
    },
  );

  it("rejects very long URLs", () => {
    expect(reasonFor(`https://example.com/${"a".repeat(MAX_URL_LENGTH)}`)).toBe("invalid_url");
  });

  it("rejects credentials in the URL", () => {
    expect(reasonFor("https://user:pass@example.com/")).toBe("credentials_not_allowed");
    expect(reasonFor("https://user@example.com/")).toBe("credentials_not_allowed");
    // The classic trick of making an internal host look like the user name.
    expect(reasonFor("https://example.com@127.0.0.1/")).toBe("credentials_not_allowed");
  });

  it.each(["22", "25", "3306", "6379", "9200", "5432", "81"])("rejects port %s", (port) => {
    expect(reasonFor(`http://example.com:${port}/`)).toBe("port_not_allowed");
  });

  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.1.1/admin",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[64:ff9b::a9fe:a9fe]/",
  ])("rejects the private address in %s", (input) => {
    expect(reasonFor(input)).toBe("address_not_public");
  });

  it.each([
    // Decimal, hexadecimal, octal and short spellings of 127.0.0.1 and friends.
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
    "http://127.1/",
    "http://127.0.1/",
    "http://0/",
    "http://3232235777/",
    "http://0xa9fea9fe/",
    // Full-width digits and a trailing dot.
    "http://１２７.０.０.１/",
    "http://127.0.0.1./",
  ])("sees through the disguised address in %s", (input) => {
    expect(reasonFor(input)).toBe("address_not_public");
  });

  it.each([
    "http://localhost/",
    "http://LOCALHOST:8080/",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://wiki.corp/",
    "http://router.lan/",
    "http://nas.home.arpa/",
    "http://intranet/",
    "http://metadata/",
    "http://abc.onion/",
    "http://localhost./",
  ])("rejects the non-public name in %s", (input) => {
    expect(reasonFor(input)).toBe("hostname_not_allowed");
  });

  it("does not leak internal details in messages", () => {
    const result = checkUrl("http://192.168.1.1/");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("The address is not a public internet address (private).");
    }
  });
});
