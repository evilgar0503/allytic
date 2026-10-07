import { describe, expect, it } from "vitest";
import { classifyAddress, parseIpv4, parseIpv6 } from "./ip.js";

function blocked(address: string) {
  const verdict = classifyAddress(address);
  if (verdict.kind !== "address") throw new Error(`${address} was not recognised as an address`);
  return verdict.blocked;
}

describe("parseIpv4", () => {
  it("accepts strict dotted decimal only", () => {
    expect(parseIpv4("192.168.0.1")).toEqual([192, 168, 0, 1]);
    for (const text of ["1.2.3", "1.2.3.4.5", "256.1.1.1", "01.2.3.4", "1.2.3.x", "", "1..2.3"]) {
      expect(parseIpv4(text)).toBeNull();
    }
  });
});

describe("parseIpv6", () => {
  it("expands compressed and mixed notations", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("2001:db8::8a2e:370:7334")).toEqual([
      0x2001, 0xdb8, 0, 0, 0, 0x8a2e, 0x370, 0x7334,
    ]);
    expect(parseIpv6("::ffff:192.168.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0001]);
    expect(parseIpv6("64:ff9b::10.0.0.1")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x0a00, 0x0001]);
    expect(parseIpv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6("1:2:3:4:5:6:1.2.3.4")).toEqual([1, 2, 3, 4, 5, 6, 0x0102, 0x0304]);
  });

  it("rejects malformed addresses and zone identifiers", () => {
    for (const text of [
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "1::2::3",
      "12345::1",
      "fe80::1%eth0",
      "g::1",
      "1.2.3.4",
      "::1.2.3",
      "1:2:3:4:5:6:7::8",
    ]) {
      expect(parseIpv6(text), text).toBeNull();
    }
  });
});

describe("classifyAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local"],
    ["169.254.0.1", "link-local"],
    ["100.64.0.1", "shared"],
    ["100.127.255.255", "shared"],
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["192.0.2.1", "documentation"],
    ["198.18.0.1", "reserved"],
  ])("blocks the IPv4 address %s as %s", (address, reason) => {
    expect(blocked(address)).toBe(reason);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "169.253.255.255",
    "192.167.255.255",
    "223.255.255.255",
  ])("allows the public IPv4 address %s", (address) => {
    expect(blocked(address)).toBeNull();
  });

  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fc00::1", "private"],
    ["fd12:3456:789a::1", "private"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["fec0::1", "private"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
    // Every way of smuggling an IPv4 address inside an IPv6 one.
    ["::ffff:127.0.0.1", "translated"],
    ["::ffff:7f00:1", "translated"],
    ["::ffff:169.254.169.254", "translated"],
    ["::ffff:8.8.8.8", "translated"],
    ["::127.0.0.1", "translated"],
    ["64:ff9b::7f00:1", "translated"],
    ["64:ff9b:1::a00:1", "translated"],
    ["2002:7f00:1::", "translated"],
    ["2002:a9fe:a9fe::", "translated"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "translated"],
    ["100::1", "reserved"],
    ["4000::1", "reserved"],
  ])("blocks the IPv6 address %s as %s", (address, reason) => {
    expect(blocked(address)).toBe(reason);
  });

  it("allows global unicast IPv6, with or without brackets", () => {
    expect(blocked("2606:4700:4700::1111")).toBeNull();
    expect(blocked("[2606:4700:4700::1111]")).toBeNull();
    expect(blocked("2a00:1450:4003:80f::200e")).toBeNull();
  });

  it("says when the text is not an address at all", () => {
    expect(classifyAddress("example.com")).toEqual({ kind: "not-an-address" });
    expect(classifyAddress("localhost")).toEqual({ kind: "not-an-address" });
    expect(classifyAddress("1.2.3")).toEqual({ kind: "not-an-address" });
  });
});
