"use client";

// Keyboard-wedge (USB/Bluetooth) scanner support.
//
// A wedge scanner "types" the code very fast and then presses Enter (or Tab).
// Three places can receive it:
//  1. The scan field itself — always on screen, dir=ltr, autocomplete off.
//     Enter or Tab ends the code (Tab only when there is something to submit).
//  2. Nowhere (focus on a button or the page) — a document listener collects
//     a FAST burst and submits it on Enter/Tab. Slow keys (a person) are
//     ignored, so normal use of the page is never hijacked.
//  3. The quantity field — see useQtyBurstGuard: a scanner burst there must
//     not become a quantity of 7,290,000,000,017.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { isWedgeBurst, WEDGE_MAX_GAP_MS } from "../../../../lib/inventory";
import { tokens } from "../../../../lib/ui";
import { field, labelStyle, secondaryBtn } from "./styles";

export type WedgeHandle = { focus: () => void; clear: () => void };

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

const WedgeInput = forwardRef<WedgeHandle, {
  onScan: (code: string) => void;
  disabled?: boolean;
  /** Catch bursts typed while nothing is focused (off while a dialog is open). */
  listenGlobally?: boolean;
}>(function WedgeInput({ onScan, disabled = false, listenGlobally = true }, ref) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; });

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    clear: () => setValue(""),
  }), []);

  const submit = () => {
    // Read the DOM value: a scanner types faster than a render can follow.
    const v = inputRef.current?.value ?? value;
    if (!v.trim()) return false;
    setValue("");
    onScanRef.current(v);
    return true;
  };

  // (2) bursts with no field focused.
  useEffect(() => {
    if (!listenGlobally || disabled) return;
    let keys: string[] = [];
    let times: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(document.activeElement)) { keys = []; times = []; return; }
      const now = performance.now();
      if (e.key === "Enter" || e.key === "Tab") {
        const text = keys.join("");
        const ok = isWedgeBurst(times, text);
        keys = []; times = [];
        if (ok) {
          e.preventDefault();
          onScanRef.current(text);
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (times.length && now - times[times.length - 1] > WEDGE_MAX_GAP_MS) { keys = []; times = []; }
      keys.push(e.key);
      times.push(now);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [listenGlobally, disabled]);

  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <label style={labelStyle} htmlFor="inv-scan">
        ברקוד — סורק או הקלדה
      </label>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          id="inv-scan"
          ref={inputRef}
          data-testid="inv-scan-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            else if (e.key === "Tab" && !e.shiftKey && value.trim()) { e.preventDefault(); submit(); }
          }}
          disabled={disabled}
          dir="ltr"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="7290000000000"
          aria-describedby="inv-scan-help"
          style={{ ...field, flex: 1, minWidth: 0, fontSize: "1.15rem", letterSpacing: "0.03em", textAlign: "left" }}
        />
        <button type="button" onClick={() => { submit(); inputRef.current?.focus(); }} disabled={disabled || !value.trim()}
          style={{ ...secondaryBtn, whiteSpace: "nowrap", opacity: disabled || !value.trim() ? 0.55 : 1 }}>
          חיפוש
        </button>
      </div>
      <span id="inv-scan-help" style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim }}>
        סורק חיצוני מקליד לכאן לבד. Enter מסיים.
      </span>
    </div>
  );
});

export default WedgeInput;

/**
 * Guard for the quantity field: a scanner burst that lands there (the manager
 * scanned the next item without saving) is taken OUT of the quantity and
 * handed to `onBurst` instead. A person typing — even fast — never reaches the
 * 5-character / 35 ms-average threshold, so normal typing is untouched.
 *
 * Returns an onKeyDown handler to spread on the input. Call `onEnter` for a
 * normal Enter.
 */
export function useQtyBurstGuard(opts: {
  getValue: () => string;
  setValue: (v: string) => void;
  /** The scanned code, and what is left in the quantity field without it. */
  onBurst: (code: string, rest: string) => void;
  onEnter: () => void;
}) {
  const keys = useRef<string[]>([]);
  const times = useRef<number[]>([]);
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = performance.now();
    if (e.key === "Enter" || e.key === "Tab") {
      const text = keys.current.join("");
      // 5+ chars: a short code (00777) after a typed "5" must not become 500,777 (R8).
      const burst = isWedgeBurst(times.current, text, 5);
      keys.current = []; times.current = [];
      if (burst) {
        e.preventDefault();
        const v = optsRef.current.getValue();
        const rest = v.endsWith(text) ? v.slice(0, v.length - text.length) : v;
        optsRef.current.setValue(rest);
        optsRef.current.onBurst(text, rest);
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); optsRef.current.onEnter(); }
      return;
    }
    if (e.key.length !== 1) { keys.current = []; times.current = []; return; }
    const t = times.current;
    if (t.length && now - t[t.length - 1] > WEDGE_MAX_GAP_MS) { keys.current = []; times.current = []; }
    keys.current.push(e.key);
    times.current.push(now);
  };
}
