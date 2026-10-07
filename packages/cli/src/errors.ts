import { AllyticError } from "@allytic/core";

/** Wrong command line. The message is shown together with a pointer to `--help`. */
export class UsageError extends AllyticError {
  readonly code = "USAGE";
}

/** The target is neither an http(s) URL nor a readable file. */
export class InvalidTargetError extends AllyticError {
  readonly code = "INVALID_TARGET";
}

/** The page could not be loaded (network error, timeout or HTTP error status). */
export class NavigationError extends AllyticError {
  readonly code = "NAVIGATION_FAILED";
}

/** Playwright has no browser binary to launch. */
export class BrowserNotInstalledError extends AllyticError {
  readonly code = "BROWSER_NOT_INSTALLED";
}

/** A report file could not be written. */
export class OutputError extends AllyticError {
  readonly code = "OUTPUT_FAILED";
}
