import { z } from "zod";

/** Returns every A and AAAA address of a host name. Throws when the lookup itself fails. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const RECORD_TYPE_A = 1;
const RECORD_TYPE_AAAA = 28;

const dohResponseSchema = z.object({
  /** DNS response code: 0 is success, 3 is NXDOMAIN. */
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

type Fetch = (input: string, init: { headers: Record<string, string> }) => Promise<Response>;

/**
 * DNS-over-HTTPS resolver. CNAME chains are followed by the DNS server; only the final
 * address records are returned. Costs two subrequests per host name.
 */
export function createDohResolver(fetchImpl: Fetch): DnsResolver {
  const query = async (hostname: string, type: "A" | "AAAA"): Promise<string[]> => {
    const response = await fetchImpl(
      `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!response.ok) throw new Error(`DNS lookup failed with HTTP ${response.status}`);

    const body = dohResponseSchema.parse(await response.json());
    // NXDOMAIN and "no records of this type" are answers, not failures.
    if (body.Status !== 0) return [];
    const wanted = type === "A" ? RECORD_TYPE_A : RECORD_TYPE_AAAA;
    return (body.Answer ?? []).filter((record) => record.type === wanted).map((r) => r.data);
  };

  return async (hostname) => {
    const [ipv4, ipv6] = await Promise.all([query(hostname, "A"), query(hostname, "AAAA")]);
    return [...ipv4, ...ipv6];
  };
}
