/** Base class for every error Allytic raises on purpose. `code` is stable and machine-readable. */
export abstract class AllyticError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The input does not look like the output of `axe.run()`. */
export class InvalidAxeResultsError extends AllyticError {
  readonly code = "INVALID_AXE_RESULTS";
}

/** The input is not an Allytic report, or was produced by an incompatible version. */
export class InvalidReportError extends AllyticError {
  readonly code = "INVALID_REPORT";
}
