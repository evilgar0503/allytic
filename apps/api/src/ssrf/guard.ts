import { classifyAddress } from "./ip.js";
import type { DnsResolver } from "./resolver.js";
import { checkUrl, describeBlockedAddress, type Rejection } from "./target.js";

export type Verdict = { ok: true } | Rejection;

export interface GuardOptions {
  resolver: DnsResolver;
  /** Redirects the page itself may follow before the audit is abandoned. */
  maxRedirects?: number;
  /**
   * Distinct host names one audit may contact. Each costs two DNS subrequests and a Worker
   * on the Free plan only has 50 per request.
   */
  maxHosts?: number;
  /** Only overridden by tests that need a local server on a random port. */
  allowedPorts?: ReadonlySet<string>;
}

export interface RequestInfo {
  url: string;
  /** Number of redirects that led to this request; 0 for a request the page made itself. */
  redirectCount: number;
  /** True for the document of the top-level page. */
  isNavigation: boolean;
}

export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_MAX_HOSTS = 10;

/** Schemes that never leave the browser, so they cannot reach anything. */
const LOCAL_SCHEMES = ["data:", "blob:", "about:"];

/**
 * Decides, for every request the audited page makes (the page itself, its redirects and its
 * subresources), whether the browser may send it.
 *
 * Known limit, stated rather than hidden: the address is checked here and then resolved again
 * by the browser, so a host that changes its DNS answer between the two (DNS rebinding) is
 * not caught. What an attacker can reach that way is the network of the rendering browser,
 * which is Cloudflare's, not ours.
 */
export function createRequestGuard(options: GuardOptions) {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxHosts = options.maxHosts ?? DEFAULT_MAX_HOSTS;
  // One verdict per host for the whole audit: a second lookup could not be trusted more than
  // the first, and it would double the subrequests.
  const hosts = new Map<string, Promise<Verdict>>();

  async function resolveHost(hostname: string): Promise<Verdict> {
    let addresses: string[];
    try {
      addresses = await options.resolver(hostname);
    } catch {
      return { ok: false, reason: "dns_failed", message: "The host name could not be looked up." };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: "dns_no_records", message: "The host name does not exist." };
    }
    // Every address must be public: one private record among public ones is enough for the
    // browser to end up connecting to it.
    for (const address of addresses) {
      const verdict = classifyAddress(address);
      if (verdict.kind !== "address") {
        return { ok: false, reason: "dns_failed", message: "The DNS answer was not understood." };
      }
      if (verdict.blocked) {
        return {
          ok: false,
          reason: "address_not_public",
          message: describeBlockedAddress(verdict.blocked),
        };
      }
    }
    return { ok: true };
  }

  return {
    async check(request: RequestInfo): Promise<Verdict> {
      if (LOCAL_SCHEMES.some((scheme) => request.url.startsWith(scheme))) return { ok: true };

      if (request.isNavigation && request.redirectCount > maxRedirects) {
        return {
          ok: false,
          reason: "too_many_redirects",
          message: `The page redirected more than ${maxRedirects} times.`,
        };
      }

      const target = checkUrl(request.url, options.allowedPorts);
      if (!target.ok) return target;
      if (target.isAddress) return { ok: true };

      const known = hosts.get(target.hostname);
      if (known) return known;
      if (hosts.size >= maxHosts) {
        return {
          ok: false,
          reason: "too_many_hosts",
          message: `The page loads content from more than ${maxHosts} different hosts.`,
        };
      }
      const verdict = resolveHost(target.hostname);
      hosts.set(target.hostname, verdict);
      return verdict;
    },

    /** Host names looked up so far, for logging and tests. */
    get hostCount(): number {
      return hosts.size;
    },
  };
}

export type RequestGuard = ReturnType<typeof createRequestGuard>;
