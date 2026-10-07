import { readFileSync } from "node:fs";

export const TOOL_NAME = "Allytic";

/** Read at runtime so it works both from `src/` (tests) and from `dist/` (published). */
export function toolVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (
    typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
  ) {
    return manifest.version;
  }
  return "0.0.0";
}
