// The optional ?cat=<name> deep link (home page category tiles → /view or
// /catalog). Read once, in the browser, when the page's state is created, so
// the very FIRST product request already asks for that category — instead of
// loading "הכל" first, showing it, and only then switching (a wasted request,
// the first photos of the wrong grid, and a visible flash of wrong products).
//
// Safe for the static prerender: on the server there is no URL, and nothing
// that depends on the category is in the first paint (the chips appear only
// after the category list loads, the grid only after products load).
// The page still checks the name against the real category list and falls
// back to "הכל" when it is unknown.
export function readUrlCategory(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const c = new URLSearchParams(window.location.search).get("cat");
    return c && c.trim() && c.length <= 200 ? c : null;
  } catch {
    return null;
  }
}
