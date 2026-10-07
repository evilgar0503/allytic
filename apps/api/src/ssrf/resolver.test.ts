import { describe, expect, it } from "vitest";
import { createDohResolver } from "./resolver.js";

type Reply = { status?: number; body: unknown };

function fakeFetch(replies: Record<string, Reply>) {
  const urls: string[] = [];
  const fetchImpl = async (input: string, init: { headers: Record<string, string> }) => {
    urls.push(input);
    expect(init.headers["accept"]).toBe("application/dns-json");
    const url = new URL(input);
    const key = `${url.searchParams.get("name")} ${url.searchParams.get("type")}`;
    const reply = replies[key] ?? { body: { Status: 3 } };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return { fetchImpl, urls };
}

describe("createDohResolver", () => {
  it("returns A and AAAA records, following CNAMEs to their final addresses", async () => {
    const { fetchImpl, urls } = fakeFetch({
      "www.example.com A": {
        body: {
          Status: 0,
          Answer: [
            { type: 5, data: "example.com." },
            { type: 1, data: "93.184.216.34" },
          ],
        },
      },
      "www.example.com AAAA": {
        body: { Status: 0, Answer: [{ type: 28, data: "2606:2800:220:1:248:1893:25c8:1946" }] },
      },
    });

    expect(await createDohResolver(fetchImpl)("www.example.com")).toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    expect(urls).toEqual([
      "https://cloudflare-dns.com/dns-query?name=www.example.com&type=A",
      "https://cloudflare-dns.com/dns-query?name=www.example.com&type=AAAA",
    ]);
  });

  it("returns nothing for names that do not exist or have no address records", async () => {
    const { fetchImpl } = fakeFetch({
      "mail-only.example.com A": { body: { Status: 0 } },
      "mail-only.example.com AAAA": { body: { Status: 0, Answer: [] } },
    });
    const resolve = createDohResolver(fetchImpl);

    expect(await resolve("nxdomain.example.com")).toEqual([]);
    expect(await resolve("mail-only.example.com")).toEqual([]);
  });

  it("encodes the name instead of letting it change the query", async () => {
    const { fetchImpl, urls } = fakeFetch({});
    await createDohResolver(fetchImpl)("a.example.com&type=TXT");
    expect(urls[0]).toBe(
      "https://cloudflare-dns.com/dns-query?name=a.example.com%26type%3DTXT&type=A",
    );
  });

  it("throws when the DNS service fails or answers nonsense", async () => {
    const failing = fakeFetch({
      "example.com A": { status: 500, body: {} },
      "example.com AAAA": { status: 500, body: {} },
    });
    await expect(createDohResolver(failing.fetchImpl)("example.com")).rejects.toThrow(/HTTP 500/);

    const garbage = fakeFetch({
      "example.com A": { body: { nope: true } },
      "example.com AAAA": { body: { nope: true } },
    });
    await expect(createDohResolver(garbage.fetchImpl)("example.com")).rejects.toThrow();
  });
});
