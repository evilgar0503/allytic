import type { BrowserWorker } from "@cloudflare/playwright";

/** Bindings and secrets of the Worker, as declared in wrangler.jsonc. */
export interface Env {
  /** Browser Rendering. */
  BROWSER: BrowserWorker;
  /**
   * Enables the phase 3b spike endpoint while it is set. Created and removed by the deploy
   * workflow; the endpoint does not exist without it.
   */
  SPIKE_TOKEN?: string;
}
