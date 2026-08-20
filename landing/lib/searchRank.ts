// Client-side re-ranking of search results.
//
// The search_products / catalog_public* RPCs return trigram-ranked rows, which
// is what makes typo-tolerant search work — but trigram similarity sometimes
// scores an unrelated product close to a real match (the reported case: searching
// "איירפודס" surfaced products that merely share letter runs). Fixing the
// ordering server-side means changing the RPCs, which is out of bounds for
// this branch — so the front end re-orders each received page instead:
//
//   1. rows whose name contains the query as-typed (after normalization)
//   2. rows whose name contains EVERY word of the query, in any order
//   3. everything else, in the order the RPC sent it (fuzzy rank)
//
// SCOPE — read this before relying on the ordering:
// The re-ranking is PAGE-LOCAL. Each infinite-scroll page (24 rows) is
// re-ordered once, in isolation, before being appended. Consequences:
//   • Within a page, exact matches always precede fuzzy ones.
//   • ACROSS pages nothing moves: an exact match that the RPC ranked onto
//     page 3 still appears after every row of pages 1-2, even fuzzy ones.
//   • Rows already on screen are never reshuffled by later pages (by design —
//     a grid that reorders under the user's finger is worse than imperfect
//     ordering).
// In practice the cross-page caveat is mostly theoretical: the RPCs score a
// literal substring hit at 1.0, so real matches already sort first globally.
//
// What this module could never fix was the size of the result SET, not its
// order. The RPCs kept every row scoring >= 0.18, so "ברבי" returned 377 rows
// for 8 real products and "בובה" returned 42% of the catalogue; a page-local
// re-rank floats the real matches to the top of page 1 and leaves 350+
// irrelevant rows below them forever. That threshold is now 0.30, measured
// against the live catalogue — see the search_products migration. This file
// is about ordering; the filtering belongs in SQL.
//
// Normalization mirrors what a person considers "the same text": final letters
// folded (ם→מ etc.), punctuation and doubled spaces dropped, case ignored.

/** Strip the characters that mean something to PostgREST or to LIKE before a
 *  query string is sent as a filter value.
 *
 *  `,` `(` `)` are PostgREST's `or=` separators; `%` and `_` are LIKE
 *  wildcards. `%` was already being removed everywhere, but `_` was not — so
 *  "לג_" quietly matched לגו, לגז and anything else with one character there,
 *  and the customer had no way to tell why. Six screens had their own copy of
 *  this line and one of them (the admin browser) had none at all until
 *  recently; there is one copy now.
 *
 *  Removed characters become a space rather than nothing, so "כדור,סל" stays
 *  two words instead of becoming one nonexistent one. */
export function sanitizeQuery(raw: string): string {
  return (raw || "").trim().replace(/[,()%_]/g, " ").replace(/\s+/g, " ").trim();
}

const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

export function normalizeHe(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/["'״׳`]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function orderExactFirst<T extends { name: string }>(rows: T[], rawQuery: string): T[] {
  const q = normalizeHe(rawQuery);
  if (q.length < 2) return rows;
  const words = q.split(" ").filter((w) => w.length >= 2);

  const tier = (name: string): number => {
    const n = normalizeHe(name);
    if (n.includes(q)) return 0;
    if (words.length > 1 && words.every((w) => n.includes(w))) return 1;
    return 2;
  };

  // Stable partition by tier (Array.prototype.sort is stable in all modern
  // engines, but a manual bucket pass makes the stability explicit).
  const buckets: T[][] = [[], [], []];
  for (const r of rows) buckets[tier(r.name)].push(r);
  return buckets[0].concat(buckets[1], buckets[2]);
}
