// Client-side re-ranking of search results.
//
// The search_products / catalog_public* RPCs return trigram-ranked rows, which
// is what makes typo-tolerant search work — but trigram similarity sometimes
// scores an unrelated product close to a真 match (the reported case: searching
// "איירפודס" surfaced products that merely share letter runs). Fixing the
// ordering server-side means changing the RPCs, which is out of bounds for
// this branch — so the front end re-orders each received page instead:
//
//   1. rows whose name contains the query as-typed (after normalization)
//   2. rows whose name contains EVERY word of the query, in any order
//   3. everything else, in the order the RPC sent it (fuzzy rank)
//
// The sort is stable and page-local: nothing is hidden, nothing is re-shuffled
// after it is already on screen (each infinite-scroll page is ranked once,
// before append).
//
// Normalization mirrors what a person considers "the same text": final letters
// folded (ם→מ etc.), punctuation and doubled spaces dropped, case ignored.

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
