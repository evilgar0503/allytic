import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { InvalidTargetError } from "./errors.js";
import { resolveTarget, sarifArtifactUri } from "./target.js";

const directory = mkdtempSync(join(tmpdir(), "allytic-target-"));
const page = join(directory, "site", "index.html");
writeFileSync(join(directory, "top.html"), "<p>top</p>");

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("resolveTarget", () => {
  it("normalizes http(s) URLs", () => {
    expect(resolveTarget("HTTPS://Example.test", directory)).toEqual({
      kind: "url",
      input: "HTTPS://Example.test",
      url: "https://example.test/",
    });
    expect(resolveTarget("http://localhost:4173/a?b=1", directory).url).toBe(
      "http://localhost:4173/a?b=1",
    );
  });

  it("resolves files relative to the working directory", () => {
    const target = resolveTarget("top.html", directory);
    expect(target).toEqual({
      kind: "file",
      input: "top.html",
      path: join(directory, "top.html"),
      url: pathToFileURL(join(directory, "top.html")).href,
    });
  });

  it.each(["ftp://example.test/file.html", "file:///etc/passwd", "javascript://alert(1)"])(
    "rejects the unsupported scheme in %s",
    (input) => {
      expect(() => resolveTarget(input, directory)).toThrow(InvalidTargetError);
      expect(() => resolveTarget(input, directory)).toThrow(/Only http:\/\/ and https:\/\//);
    },
  );

  it("rejects malformed URLs, missing files and directories", () => {
    expect(() => resolveTarget("http://", directory)).toThrow(/not a valid URL/);
    expect(() => resolveTarget("missing.html", directory)).toThrow(/no file exists at/);
    expect(() => resolveTarget(".", directory)).toThrow(/is a directory/);
  });
});

describe("sarifArtifactUri", () => {
  it("keeps URLs as they are", () => {
    const target = resolveTarget("https://example.test/a", directory);
    expect(sarifArtifactUri(target, directory)).toBe("https://example.test/a");
  });

  it("uses a forward-slash relative path for files inside the working directory", () => {
    const target = {
      kind: "file",
      input: page,
      path: page,
      url: pathToFileURL(page).href,
    } as const;
    expect(sarifArtifactUri(target, directory)).toBe("site/index.html");
  });

  it("falls back to the file URL for files outside the working directory", () => {
    const target = resolveTarget("top.html", directory);
    expect(sarifArtifactUri(target, join(directory, "site"))).toBe(target.url);
  });
});
