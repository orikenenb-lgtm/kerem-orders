"use client";

// Camera barcode scanner.
//
// * The camera is requested ONLY when this component mounts, i.e. after the
//   manager taps "סריקת ברקוד" — never on page load.
// * Native window.BarcodeDetector is used when it can read EAN-13; otherwise
//   the barcode-detector ponyfill is imported dynamically (so it loads only on
//   this screen, never in the catalogue bundle), with its wasm self-hosted
//   under /zxing/ — no CDN.
// * A code is accepted only when the SAME value is read on 2 consecutive
//   frames (~150 ms apart), to filter misreads.
// * Every track is stopped after a read, on close, on unmount and when the
//   tab is hidden.

import { useEffect, useRef, useState } from "react";
import { tokens } from "../../../../lib/ui";
import { bigBtn, ERR } from "./styles";

export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"] as const;
const FRAME_MS = 150;

type Detected = { rawValue: string };
type Detector = { detect: (src: HTMLVideoElement) => Promise<Detected[]> };
type NativeCtor = {
  new (o: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

let ponyfillReady: Promise<Detector> | null = null;

async function makeDetector(): Promise<Detector> {
  const Native = (globalThis as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  if (Native && typeof Native.getSupportedFormats === "function") {
    try {
      const supported = await Native.getSupportedFormats();
      if (supported.includes("ean_13")) {
        return new Native({ formats: SCAN_FORMATS.filter((f) => supported.includes(f)) });
      }
    } catch { /* fall through to the ponyfill */ }
  }
  if (!ponyfillReady) {
    ponyfillReady = import("barcode-detector/ponyfill").then((mod) => {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      mod.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `${base}/zxing/${path}` : prefix + path),
        },
      });
      return new mod.BarcodeDetector({ formats: [...SCAN_FORMATS] }) as unknown as Detector;
    });
    ponyfillReady.catch(() => { ponyfillReady = null; });
  }
  return ponyfillReady;
}

/** A Hebrew sentence for a getUserMedia / detector failure. */
export function cameraErrorText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "אין הרשאה למצלמה. אפשר לאשר אותה בהגדרות הדפדפן — או להמשיך עם סורק ברקודים או חיפוש.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return "לא נמצאה מצלמה במכשיר. אפשר להמשיך עם סורק ברקודים או חיפוש.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "המצלמה תפוסה (אולי באפליקציה אחרת). סגרו אותה ונסו שוב, או המשיכו עם סורק או חיפוש.";
  }
  if (name === "InsecureContext") {
    return "המצלמה זמינה רק בחיבור מאובטח (https). אפשר להמשיך עם סורק ברקודים או חיפוש.";
  }
  return "לא הצלחנו להפעיל את סורק המצלמה. אפשר להמשיך עם סורק ברקודים או חיפוש.";
}

export default function Scanner({ onDetected, onClose }: {
  onDetected: (code: string) => void;
  /** Closed by the manager, by a hidden tab, or after an error (message given). */
  onClose: (error?: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [phase, setPhase] = useState<"starting" | "scanning">("starting");
  const cbRef = useRef({ onDetected, onClose });
  useEffect(() => { cbRef.current = { onDetected, onClose }; });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    let last = "";

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
    const finish = (code?: string, error?: string) => {
      if (done) return;
      done = true;
      stop();
      if (code) cbRef.current.onDetected(code);
      else cbRef.current.onClose(error);
    };

    const onVis = () => { if (document.visibilityState === "hidden") finish(undefined, "המצלמה נסגרה כי עברתם למסך אחר."); };
    document.addEventListener("visibilitychange", onVis);

    (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("insecure"), { name: "InsecureContext" });
        }
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (done) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (!v) { finish(); return; }
        v.srcObject = s;
        await v.play().catch(() => { /* autoplay+muted normally plays; frames still arrive */ });
        const detector = await makeDetector();
        if (done) return;
        setPhase("scanning");
        const tick = async () => {
          if (done) return;
          const video = videoRef.current;
          if (video && video.readyState >= 2) {
            try {
              const found = await detector.detect(video);
              const value = found[0]?.rawValue?.trim() ?? "";
              if (value && value === last) { finish(value); return; }
              last = value;
            } catch { /* a bad frame — keep going */ }
          }
          if (!done) timer = setTimeout(() => { void tick(); }, FRAME_MS);
        };
        void tick();
      } catch (e) {
        finish(undefined, cameraErrorText(e));
      }
    })();

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      done = true;
      stop();
    };
  }, []);

  useEffect(() => { closeRef.current?.focus(); }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="סריקת ברקוד במצלמה"
      onKeyDown={(e) => { if (e.key === "Escape") cbRef.current.onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,8,20,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "1rem", gap: "0.9rem" }}>
      <div style={{ position: "relative", width: "min(100%, 520px)", aspectRatio: "3 / 4", maxHeight: "70vh", borderRadius: 18, overflow: "hidden", background: "#000" }}>
        <video ref={videoRef} playsInline muted autoPlay aria-label="תצוגת המצלמה"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        <div aria-hidden="true" style={{ position: "absolute", left: "10%", right: "10%", top: "38%", height: "24%", border: "3px solid rgba(255,255,255,0.9)", borderRadius: 12, boxShadow: "0 0 0 2000px rgba(0,0,0,0.25)" }} />
      </div>
      <p role="status" style={{ fontFamily: tokens.assistant, color: "#fff", fontSize: "1rem", margin: 0, textAlign: "center" }}>
        {phase === "starting" ? "מפעילים את המצלמה…" : "כוונו את הברקוד למסגרת. הקריאה נעשית לבד."}
      </p>
      <button ref={closeRef} type="button" onClick={() => cbRef.current.onClose()} style={{ ...bigBtn(false), maxWidth: 520, background: "#fff", color: ERR, boxShadow: "none" }}>
        סגירת המצלמה
      </button>
    </div>
  );
}
