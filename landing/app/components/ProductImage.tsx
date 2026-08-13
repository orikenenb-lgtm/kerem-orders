"use client";

// THE product image. Every screen that shows a product photo renders this
// component, so the whole site shares ONE fallback chain (lib/imageFallback.ts):
//
//   proxy → single delayed proxy retry → direct HTTPS original → placeholder
//
// Guarantees:
//   * bounded — at most 3 network attempts per product, never a retry loop;
//   * the retry timer is cleared on unmount;
//   * error state resets when the product (or variant) changes;
//   * the placeholder is accessible (role="img" + Hebrew label);
//   * customers never see technical error details — screens that need them
//     (the admin fixing screens) read the machine state via onStatus.

import { useEffect, useRef, useState } from "react";
import {
  ATTEMPT_PROXY,
  nextAttempt,
  srcForAttempt,
  stageOf,
  type FallbackStage,
} from "../../lib/imageFallback";

export type ProductImageStatus = {
  phase: "loading" | "loaded" | "failed";
  /** Which stage the chain is on / died on — for manager diagnostics only. */
  stage: FallbackStage;
};

export default function ProductImage({
  pictureLink,
  name,
  width = 480,
  rotation = 0,
  imgStyle,
  placeholderStyle,
  onStatus,
  retryKey = 0,
}: {
  pictureLink: string | null | undefined;
  /** Product name — becomes the alt text. */
  name: string;
  /** Proxy resize width. Keep to the shared 480/900/960 set so the CDN cache stays warm. */
  width?: number;
  /** Saved server-side rotation (products.rotation_override). */
  rotation?: number | null;
  /** Styling for the <img> itself (object-fit, transforms…). */
  imgStyle?: React.CSSProperties;
  placeholderStyle?: React.CSSProperties;
  /** Manager screens subscribe here to disable controls / show the failure stage. */
  onStatus?: (s: ProductImageStatus) => void;
  /** Bump to restart the whole chain (the admin "נסה שוב" button). */
  retryKey?: number;
}) {
  const link = pictureLink || "";
  const rot = rotation ?? 0;
  const [attempt, setAttempt] = useState(ATTEMPT_PROXY);
  const [phase, setPhase] = useState<"loading" | "loaded" | "failed">("loading");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restart the chain whenever the product/variant changes (or on manual retry),
  // and never let a pending retry timer fire into an unmounted/stale card.
  useEffect(() => {
    setAttempt(ATTEMPT_PROXY);
    setPhase("loading");
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [link, width, rot, retryKey]);

  // Keep the parent informed without making the callback a render dependency.
  // The ref is synced in its own effect (declared FIRST so it runs before the
  // reporting effect below within the same commit).
  const onStatusRef = useRef(onStatus);
  useEffect(() => { onStatusRef.current = onStatus; });
  const src = srcForAttempt(link, attempt, width, rot);
  const failed = !src || phase === "failed";
  useEffect(() => {
    onStatusRef.current?.({
      phase: failed ? "failed" : phase,
      stage: stageOf(attempt, link),
    });
  }, [failed, phase, attempt, link]);

  const onError = () => {
    const next = nextAttempt(attempt, link);
    if (!next) {
      setPhase("failed");
      return;
    }
    if (!srcForAttempt(link, next.attempt, width, rot)) {
      // The next stage has nothing to load (e.g. non-HTTPS source) — give up now.
      setPhase("failed");
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setAttempt(next.attempt);
    }, next.delayMs);
  };

  if (failed) {
    return (
      <span
        role="img"
        aria-label="תמונת המוצר אינה זמינה"
        style={placeholderStyle}
      >
        🧸
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onLoad={() => setPhase("loaded")}
      onError={onError}
      style={{ width: "100%", height: "100%", objectFit: "contain", ...imgStyle }}
    />
  );
}
