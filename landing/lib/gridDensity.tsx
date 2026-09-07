"use client";

// How many products per row — the customer's choice, remembered per browser.
//
// Wholesale buyers scroll hundreds of items on a phone; two per row is
// comfortable, three shows 50% more per screen, four is dense. The owner asked
// for the customer to choose, on every catalogue.
//
// Pure presentation. This decides ONE CSS value (grid-template-columns) and
// nothing else: no query, no price, no cart, no order path is involved.
//
// "auto" is exactly the layout every catalogue had before this existed —
// the same auto-fill expression, verbatim — and it is the default. So a
// customer who never touches the control sees no change at all, and turning
// the flag off restores that layout for everyone.
//
// Read through useSyncExternalStore rather than an effect: the pages are
// statically prerendered, so the server snapshot is always "auto" and the
// stored value only applies once React is running in the browser. That avoids
// both a hydration mismatch (the server cannot know the phone's setting) and
// the setState-in-effect pattern.

import { useCallback, useSyncExternalStore } from "react";
import { featureFlags } from "./featureFlags";
import { tokens } from "./ui";

export type GridDensity = "auto" | "2" | "3" | "4";

const KEY = "kt_grid_cols";
const EVT = "kt-grid-cols-change";
const VALID: ReadonlySet<string> = new Set(["auto", "2", "3", "4"]);
const enabled = featureFlags.ff_grid_density;

/** The pre-existing layout, unchanged. Kept in ONE place so the four grids
 *  that share it cannot drift apart again. */
export const AUTO_COLUMNS = "repeat(auto-fill, minmax(clamp(132px, 46%, 150px), 1fr))";

function readStored(): GridDensity {
  if (!enabled) return "auto";
  try {
    const v = localStorage.getItem(KEY) ?? "";
    return VALID.has(v) ? (v as GridDensity) : "auto";
  } catch {
    // localStorage can throw (private mode, blocked storage, previews).
    return "auto";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVT, onChange);
  };
}

const serverSnapshot = (): GridDensity => "auto";

// Four across on a 390px phone gives each card ~47px of content: the 13-digit
// barcode alone is 73px, and no font size makes that legible — measured, not
// guessed. Below this width "4" is not offered, and a "4" remembered from a
// wider screen renders as 3, so rotating a tablet or handing a phone the same
// browser profile can never produce a broken row. At 640px a 4-wide column is
// ~136px — as wide as the auto layout already uses.
const NARROW_QUERY = "(max-width: 639px)";
function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const readNarrow = () => window.matchMedia(NARROW_QUERY).matches;
const serverNarrow = () => false;

/** True below 640px. Exported for the picker; grids only need the density. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, readNarrow, serverNarrow);
}

/** The density a grid should actually render: the stored choice, except that
 *  "4" collapses to "3" on a narrow screen. */
export function useGridDensity(): [GridDensity, (d: GridDensity) => void] {
  const stored = useSyncExternalStore(subscribe, readStored, serverSnapshot);
  const narrow = useIsNarrow();
  const set = useCallback((d: GridDensity) => {
    if (!enabled) return;
    try { localStorage.setItem(KEY, d); } catch { /* storage blocked: the choice just does not persist */ }
    window.dispatchEvent(new Event(EVT));
  }, []);
  return [stored === "4" && narrow ? "3" : stored, set];
}

/** The grid-template-columns value for a density. Explicit columns use
 *  minmax(0, 1fr) so a long product name cannot widen its column and push the
 *  row off the phone — the failure mode the whole 3B programme kept meeting. */
export function gridColumns(d: GridDensity): string {
  return d === "auto" ? AUTO_COLUMNS : `repeat(${d}, minmax(0, 1fr))`;
}

const OPTIONS: { value: GridDensity; label: string; title: string }[] = [
  { value: "auto", label: "אוטו", title: "פריסה אוטומטית לפי רוחב המסך" },
  { value: "2", label: "2", title: "שני מוצרים בשורה" },
  { value: "3", label: "3", title: "שלושה מוצרים בשורה" },
  { value: "4", label: "4", title: "ארבעה מוצרים בשורה" },
];

/** Segmented control. Renders nothing when the flag is off, so callers can
 *  mount it unconditionally. 44px targets — it is a thumb control. */
export function GridDensityPicker({ value, onChange }: { value: GridDensity; onChange: (d: GridDensity) => void }) {
  // Hooks run unconditionally; the flag gate comes after them.
  const narrow = useIsNarrow();
  if (!enabled) return null;
  const options = narrow ? OPTIONS.filter((o) => o.value !== "4") : OPTIONS;
  return (
    <div role="group" aria-label="כמה מוצרים בשורה" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <span aria-hidden="true" style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, whiteSpace: "nowrap" }}>בשורה:</span>
      <div style={{ display: "inline-flex", border: `1px solid ${tokens.border}`, borderRadius: 999, background: "#fff", overflow: "hidden" }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              title={o.title}
              style={{
                minWidth: 44, minHeight: 44, padding: "0 0.7rem",
                fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.82rem",
                border: "none", cursor: "pointer",
                background: active ? tokens.accent : "transparent",
                color: active ? "#fff" : tokens.body,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
