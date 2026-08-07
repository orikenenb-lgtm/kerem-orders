import { supabase } from "./supabaseClient";
import { MIN_ORDER_FALLBACK } from "./config";

// Shared, memoized read of the public min_order_total setting.
//
// The header, footer and landing screen each render on the same page and each
// used to fire an identical `site_settings?key=min_order_total` request — 2-3
// duplicate RLS round-trips per navigation. This caches the in-flight/resolved
// promise so all consumers share ONE request, while keeping the exact same
// fallback semantics (any failure or missing/invalid row → MIN_ORDER_FALLBACK).
let cached: Promise<number> | null = null;

export function getMinOrderTotal(): Promise<number> {
  if (cached) return cached;
  const p = (async () => {
    try {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "min_order_total")
        .maybeSingle();
      // maybeSingle reports failures via `error`, not a thrown exception —
      // surface it so the catch clears the cache instead of caching the
      // fallback and blocking retries for the rest of the session.
      if (error) throw error;
      const n = Number((data as { value: string } | null)?.value);
      return Number.isFinite(n) && n > 0 ? n : MIN_ORDER_FALLBACK;
    } catch {
      // Don't cache a transient failure — let a later mount retry.
      cached = null;
      return MIN_ORDER_FALLBACK;
    }
  })();
  cached = p;
  return p;
}
