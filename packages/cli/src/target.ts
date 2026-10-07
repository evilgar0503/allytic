import { statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { InvalidTargetError } from "./errors.js";

export type ResolvedTarget =
  | { kind: "url"; input: string; url: string }
  | { kind: "file"; input: string; url: string; path: string };

const HTTP_URL = /^https?:\/\//i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Decides whether `input` is a web page or a local file and returns the URL to open. */
export function resolveTarget(input: string, cwd: string): ResolvedTarget {
  if (HTTP_URL.test(input)) {
    if (!URL.canParse(input)) throw new InvalidTargetError(`"${input}" is not a valid URL.`);
    return { kind: "url", input, url: new URL(input).href };
  }
  if (OTHER_SCHEME.test(input)) {
    throw new InvalidTargetError(
      `Unsupported URL scheme in "${input}". Only http:// and https:// URLs can be audited.`,
    );
  }

  const path = resolve(cwd, input);
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) {
    throw new InvalidTargetError(`"${input}" is not an http(s) URL and no file exists at ${path}.`);
  }
  if (!stats.isFile()) {
    throw new InvalidTargetError(`"${input}" is a directory. Pass the path to an HTML file.`);
  }
  return { kind: "file", input, url: pathToFileURL(path).href, path };
}

/**
 * Location recorded in SARIF. For files inside `cwd` it is the relative path with forward
 * slashes, which is what GitHub Code Scanning needs to link an alert to a file of the repo.
 */
export function sarifArtifactUri(target: ResolvedTarget, cwd: string): string {
  if (target.kind === "url") return target.url;
  const relativePath = relative(cwd, target.path);
  // On Windows a path on another drive stays absolute.
  const insideCwd =
    relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
  return insideCwd ? relativePath.split(sep).join("/") : target.url;
}
