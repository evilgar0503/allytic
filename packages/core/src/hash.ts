/**
 * FNV-1a (32-bit) as 8 hex characters. Used for stable, non-cryptographic identifiers
 * (finding ids, SARIF fingerprints); it has no dependency on Node or Web Crypto.
 */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
