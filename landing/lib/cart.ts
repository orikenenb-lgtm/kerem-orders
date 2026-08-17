// Safe reader for the persisted cart (localStorage key kt_cart_v2).
//
// The cart is a plain id→line record. A corrupt or unexpected value — "null",
// "[]", a bare number/string written by an older build, another tab, or a
// browser extension — must never reach the catalog/product render code, where
// `Object.entries(cart)` or `cart[id]?.qty` on a non-object throws and leaves
// the page permanently broken (the bad value is never cleared on its own).
// This returns {} for anything that isn't a real object map, so a damaged
// entry degrades to "empty cart" instead of a crash.
export function readCart<T = unknown>(raw: string | null): Record<string, T> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, T>;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}
