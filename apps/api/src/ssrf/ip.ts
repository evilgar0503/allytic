/** Why an address must never be fetched on behalf of a visitor. */
export type AddressBlockReason =
  | "unspecified"
  | "loopback"
  | "private"
  | "link-local"
  | "shared"
  | "multicast"
  | "documentation"
  | "translated"
  | "reserved";

/** Parses strict dotted-decimal IPv4 ("192.168.0.1"). Other spellings are not accepted here. */
export function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * Parses an IPv6 address (without brackets) into its eight 16-bit groups. Supports "::" and a
 * trailing dotted IPv4 part. Zone identifiers ("%eth0") are rejected: they only make sense
 * for link-local addresses.
 */
export function parseIpv6(text: string): number[] | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(":")) return null;

  let head = text;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const ipv4 = parseIpv4(last);
    if (!ipv4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = ipv4;
    tail = [(a << 8) | b, (c << 8) | d];
    // Keep the colon when it belongs to a "::" right before the IPv4 part.
    head = text.slice(0, text[lastColon - 1] === ":" ? lastColon + 1 : lastColon);
  }

  const halves = head.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const left = parseGroups(halves[0] ?? "");
  const right = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  if (!left || !right) return null;

  const explicit = left.length + right.length + tail.length;
  if (halves.length === 2) {
    if (explicit > 7) return null;
    return [...left, ...new Array<number>(8 - explicit).fill(0), ...right, ...tail];
  }
  return explicit === 8 ? [...left, ...tail] : null;
}

interface Ipv4Range {
  base: [number, number, number, number];
  bits: number;
  reason: AddressBlockReason;
}

const BLOCKED_IPV4: readonly Ipv4Range[] = [
  { base: [0, 0, 0, 0], bits: 8, reason: "unspecified" },
  { base: [10, 0, 0, 0], bits: 8, reason: "private" },
  { base: [100, 64, 0, 0], bits: 10, reason: "shared" },
  { base: [127, 0, 0, 0], bits: 8, reason: "loopback" },
  // Includes 169.254.169.254, the cloud metadata endpoint.
  { base: [169, 254, 0, 0], bits: 16, reason: "link-local" },
  { base: [172, 16, 0, 0], bits: 12, reason: "private" },
  { base: [192, 0, 0, 0], bits: 24, reason: "reserved" },
  { base: [192, 0, 2, 0], bits: 24, reason: "documentation" },
  { base: [192, 88, 99, 0], bits: 24, reason: "reserved" },
  { base: [192, 168, 0, 0], bits: 16, reason: "private" },
  { base: [198, 18, 0, 0], bits: 15, reason: "reserved" },
  { base: [198, 51, 100, 0], bits: 24, reason: "documentation" },
  { base: [203, 0, 113, 0], bits: 24, reason: "documentation" },
  { base: [224, 0, 0, 0], bits: 4, reason: "multicast" },
  { base: [240, 0, 0, 0], bits: 4, reason: "reserved" },
];

function toUint32(octets: readonly number[]): number {
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function classifyIpv4(octets: readonly number[]): AddressBlockReason | null {
  const address = toUint32(octets);
  for (const range of BLOCKED_IPV4) {
    const mask = (0xffffffff << (32 - range.bits)) >>> 0;
    if ((address & mask) >>> 0 === (toUint32(range.base) & mask) >>> 0) return range.reason;
  }
  return null;
}

/**
 * Only global unicast addresses (2000::/3) are allowed, minus the ranges inside it that are
 * not ordinary hosts. Everything that embeds an IPv4 address (mapped, NAT64, 6to4, Teredo) is
 * refused outright instead of being unwrapped: a real website has no reason to be reached
 * that way, and each of those forms is a classic way around an IPv4 block list.
 */
export function classifyIpv6(groups: readonly number[]): AddressBlockReason | null {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;

  if (groups.every((group) => group === 0)) return "unspecified";
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return "loopback";
  }
  // ::ffff:a.b.c.d (IPv4-mapped) and the deprecated ::a.b.c.d (IPv4-compatible).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return "translated";
  }
  if (g0 === 0x64 && g1 === 0xff9b) return "translated"; // NAT64, well-known and local-use
  if ((g0 & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return "link-local"; // fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return "private"; // fec0::/10 site-local, deprecated
  if ((g0 & 0xff00) === 0xff00) return "multicast"; // ff00::/8
  if ((g0 & 0xe000) !== 0x2000) return "reserved"; // anything outside 2000::/3

  if (g0 === 0x2001 && g1 === 0x0db8) return "documentation"; // 2001:db8::/32
  if (g0 === 0x2001 && g1 === 0) return "translated"; // 2001::/32 Teredo
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0010) return "reserved"; // 2001:10::/28 ORCHID
  if (g0 === 0x2002) return "translated"; // 2002::/16 6to4
  return null;
}

export type AddressVerdict =
  | { kind: "not-an-address" }
  | { kind: "address"; version: 4 | 6; blocked: AddressBlockReason | null };

/** Classifies a string that may be an IPv4 or IPv6 address (IPv6 with or without brackets). */
export function classifyAddress(text: string): AddressVerdict {
  const ipv4 = parseIpv4(text);
  if (ipv4) return { kind: "address", version: 4, blocked: classifyIpv4(ipv4) };

  const unbracketed = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  const ipv6 = parseIpv6(unbracketed);
  if (ipv6) return { kind: "address", version: 6, blocked: classifyIpv6(ipv6) };

  return { kind: "not-an-address" };
}
