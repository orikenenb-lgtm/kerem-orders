// Pure fallback state-machine for product images — the ONE place that decides
// which URL a product image tries next and when it gives up.
//
// The chain (each attempt is a single, bounded step — never a loop):
//   0  proxy          rivhit-img resized variant (cached on the CDN)
//   1  proxy-retry    same URL again after a short delay (a cold worker may
//                     simply be warm by now)
//   2  direct         the original Rivhit URL, only when it is real HTTPS —
//                     a TEMPORARY safety net, not the architecture: it ships
//                     the full-size original, so it is used only when no
//                     resized variant could be produced at all
//   3  exhausted      accessible placeholder
//
// Kept free of React so it can be unit-tested with plain node (tests/
// imageFallback.test.mjs) exactly like lib/quantity.ts.

import { rivhitImg } from "./images";

export const ATTEMPT_PROXY = 0;
export const ATTEMPT_PROXY_RETRY = 1;
export const ATTEMPT_DIRECT = 2;
export const ATTEMPT_EXHAUSTED = 3;

export type FallbackStage = "proxy" | "proxy-retry" | "direct" | "exhausted" | "no-url";

/** Direct fallback is allowed only for a real HTTPS source — never http:,
 *  data:, javascript: or free-text junk that happens to sit in the DB. */
export function isDirectFallbackAllowed(pictureLink: string): boolean {
  return /^https:\/\//i.test(pictureLink || "");
}

/** Human-readable stage (manager diagnostics only — customers never see it). */
export function stageOf(attempt: number, pictureLink: string): FallbackStage {
  if (!pictureLink) return "no-url";
  if (attempt <= ATTEMPT_PROXY) return "proxy";
  if (attempt === ATTEMPT_PROXY_RETRY) return "proxy-retry";
  if (attempt === ATTEMPT_DIRECT) return "direct";
  return "exhausted";
}

/** The URL to load for a given attempt; "" means "render the placeholder". */
export function srcForAttempt(pictureLink: string, attempt: number, w = 480, rot = 0): string {
  if (!pictureLink) return "";
  if (attempt <= ATTEMPT_PROXY_RETRY) return rivhitImg(pictureLink, w, rot);
  if (attempt === ATTEMPT_DIRECT && isDirectFallbackAllowed(pictureLink)) return pictureLink;
  return "";
}

/** Next step after `attempt` failed, or null when the chain is done.
 *  The delay before the proxy retry gives a cold edge worker time to warm up;
 *  a source that can never work (non-HTTPS) skips the direct stage entirely. */
export function nextAttempt(
  attempt: number,
  pictureLink: string
): { attempt: number; delayMs: number } | null {
  if (attempt >= ATTEMPT_EXHAUSTED) return null;
  if (attempt === ATTEMPT_PROXY) return { attempt: ATTEMPT_PROXY_RETRY, delayMs: 1200 };
  if (attempt === ATTEMPT_PROXY_RETRY) {
    return isDirectFallbackAllowed(pictureLink)
      ? { attempt: ATTEMPT_DIRECT, delayMs: 300 }
      : { attempt: ATTEMPT_EXHAUSTED, delayMs: 0 };
  }
  return { attempt: ATTEMPT_EXHAUSTED, delayMs: 0 };
}
