import { type AddressBlockReason, classifyAddress } from "./ip.js";

export type RejectionReason =
  | "invalid_url"
  | "scheme_not_allowed"
  | "credentials_not_allowed"
  | "port_not_allowed"
  | "hostname_not_allowed"
  | "address_not_public"
  | "dns_no_records"
  | "dns_failed"
  | "too_many_redirects"
  | "too_many_hosts";

export interface Rejection {
  ok: false;
  reason: RejectionReason;
  /** Safe to show to the visitor: never contains resolved addresses or internal details. */
  message: string;
}

export interface AcceptedUrl {
  ok: true;
  url: URL;
  /** Lower-case hostname without brackets or trailing dot. */
  hostname: string;
  /** True when the hostname is an IP literal (already checked to be public). */
  isAddress: boolean;
}

export const MAX_URL_LENGTH = 2048;

/** Ports a public website is plausibly served on. Anything else looks like port scanning. */
export const DEFAULT_ALLOWED_PORTS: ReadonlySet<string> = new Set([
  "",
  "80",
  "443",
  "8080",
  "8443",
]);

/**
 * Names that never belong to a public website: special-use TLDs (RFC 6761, RFC 6762, RFC 8375)
 * and the suffixes that private networks commonly use.
 */
const BLOCKED_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "home.arpa",
  "test",
  "invalid",
  "example",
  "onion",
];

function reject(reason: RejectionReason, message: string): Rejection {
  return { ok: false, reason, message };
}

export function describeBlockedAddress(reason: AddressBlockReason): string {
  return `The address is not a public internet address (${reason}).`;
}

/**
 * Checks everything that can be decided from the URL text alone. Relies on the WHATWG URL
 * parser to normalize disguised IPv4 spellings (decimal, octal, hex, short forms) and
 * internationalized host names before looking at them.
 */
export function checkUrl(
  input: string,
  allowedPorts: ReadonlySet<string> = DEFAULT_ALLOWED_PORTS,
): AcceptedUrl | Rejection {
  if (input.length > MAX_URL_LENGTH) {
    return reject("invalid_url", `The URL is longer than ${MAX_URL_LENGTH} characters.`);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return reject("invalid_url", "That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return reject("scheme_not_allowed", "Only http:// and https:// URLs can be audited.");
  }
  if (url.username !== "" || url.password !== "") {
    return reject("credentials_not_allowed", "URLs with a user name or password are not allowed.");
  }
  if (!allowedPorts.has(url.port)) {
    return reject("port_not_allowed", `Port ${url.port} is not allowed.`);
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (hostname === "") return reject("invalid_url", "The URL has no host name.");

  const address = classifyAddress(hostname);
  if (address.kind === "address") {
    return address.blocked
      ? reject("address_not_public", describeBlockedAddress(address.blocked))
      : { ok: true, url, hostname, isAddress: true };
  }

  const labels = hostname.split(".");
  if (labels.length < 2) {
    return reject("hostname_not_allowed", "The host name is not a public domain name.");
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    return reject("hostname_not_allowed", "That host name is reserved for private networks.");
  }

  return { ok: true, url, hostname, isAddress: false };
}
