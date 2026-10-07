import type { Page } from "playwright-core";
import type { RequestGuard } from "../ssrf/guard.js";
import type { Rejection } from "../ssrf/target.js";

export interface GuardLog {
  /** Requests that were not allowed to leave the browser. */
  blocked: { url: string; rejection: Rejection }[];
  /** Why the page itself (or one of its redirects) was refused, if it was. */
  navigationRejection: Rejection | null;
  /** Requests seen, allowed or not. */
  requests: number;
}

/**
 * Makes every request of the page go through the guard before it is sent.
 *
 * It uses the DevTools Fetch domain directly instead of Playwright's `page.route`, because
 * `page.route` handlers are not called again for the hops of a redirect, and re-validating
 * every hop is the whole point: a public page must not be able to redirect the browser to an
 * internal address. With the Fetch domain each hop is paused as a new request.
 *
 * Not covered: WebSocket handshakes, which do not go through the Fetch domain.
 */
export async function installRequestGuard(page: Page, guard: RequestGuard): Promise<GuardLog> {
  const log: GuardLog = { blocked: [], navigationRejection: null, requests: 0 };
  const session = await page.context().newCDPSession(page);

  const { frameTree } = await session.send("Page.getFrameTree");
  const mainFrameId = frameTree.frame.id;
  /** Redirects that led to each paused request, by Fetch request id. */
  const redirectCounts = new Map<string, number>();

  session.on("Fetch.requestPaused", (event) => {
    const redirectCount =
      event.redirectedRequestId === undefined
        ? 0
        : (redirectCounts.get(event.redirectedRequestId) ?? 0) + 1;
    redirectCounts.set(event.requestId, redirectCount);
    log.requests++;

    const url = event.request.url;
    const isNavigation = event.resourceType === "Document" && event.frameId === mainFrameId;

    void guard
      .check({ url, redirectCount, isNavigation })
      .then(async (verdict) => {
        if (verdict.ok) {
          await session.send("Fetch.continueRequest", { requestId: event.requestId });
          return;
        }
        log.blocked.push({ url, rejection: verdict });
        if (isNavigation) log.navigationRejection ??= verdict;
        await session.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
      })
      // The page or the browser may be gone by the time the verdict arrives.
      .catch(() => {});
  });

  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return log;
}
