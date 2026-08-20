"use client";

import { tokens } from "../../lib/ui";

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
  ATTEMPT_DIRECT,
  ATTEMPT_PROXY,
  reduceError,
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
    // The whole decision is pure (and unit-tested in lib/imageFallback.ts);
    // this handler only arms the single timer or flips to the terminal state.
    const decision = reduceError(attempt, link, width, rot);
    if (decision.type === "fail") {
      setAttempt(decision.attempt);
      setPhase("failed");
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setAttempt(decision.attempt);
    }, decision.delayMs);
  };

  if (failed) {
    // Own the placeholder here rather than inheriting a font-size from whatever
    // card happens to wrap us. Two call sites set 2.6rem and two set nothing, so
    // the same "no image" state rendered as a 42px teddy on one screen and a
    // 16px speck floating in a 327px white square on another. Rivhit photos do
    // fail, so this is a state customers really see.
    return (
      <span
        role="img"
        aria-label="תמונת המוצר אינה זמינה"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.35rem",
          width: "100%",
          height: "100%",
          background: tokens.surface,
          color: tokens.dim,
          fontSize: "clamp(1.8rem, 24%, 3.25rem)",
          lineHeight: 1,
          ...placeholderStyle,
        }}
      >
        <span aria-hidden="true">🧸</span>
        <span aria-hidden="true" style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", lineHeight: 1.2 }}>
          אין תמונה
        </span>
      </span>
    );
  }

  // The proxy bakes the saved rotation into the pixels; the direct original
  // does not — so on the direct fallback the same rotation is applied in CSS
  // (composed BEFORE any caller transform; quarter/odd turns shrink to stay
  // inside the frame, like the admin preview does).
  const directRotate =
    attempt === ATTEMPT_DIRECT && rot
      ? `rotate(${rot}deg) scale(${rot % 180 === 0 ? 1 : rot % 90 === 0 ? 0.78 : 0.68})`
      : "";
  const transform = [directRotate, imgStyle?.transform].filter(Boolean).join(" ") || undefined;

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
      // While a failed attempt waits for the next one, the element is still in
      // the DOM. Without this it renders the broken-image glyph and the alt text
      // at the card's 2.6rem font size, clipped mid-word — for 1.5s per card.
      style={{ width: "100%", height: "100%", objectFit: "contain", fontSize: 0, color: "transparent", ...imgStyle, transform }}
    />
  );
}
