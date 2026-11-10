// The bottom of a product grid while more products are on their way.
//
// The owner: customers scroll a category, reach the end of what has loaded so
// far, see a small grey "טוען עוד מוצרים…" and think the category is over. So
// the tail now LOOKS like the list goes on — a row of placeholder cards in the
// same grid — and says plainly how many products there are and that the rest
// is coming. Used by the store (/catalog), the public catalogue (/view,
// /prices) and custom catalogues (/collection).

import { tokens } from "../../lib/ui";

export default function LoadMoreTail({ shown, total, columns }: { shown: number; total: number; columns: string }) {
  const left = Math.max(0, total - shown);
  return (
    <div style={{ marginTop: "1rem" }}>
      <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: columns, gap: "1rem" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kt-skel" style={{ border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusCard, padding: "0.9rem", background: "#fff", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ aspectRatio: "1 / 1", borderRadius: 12, background: tokens.surface }} />
            <div style={{ height: "0.85em", borderRadius: 6, background: tokens.surface }} />
            <div style={{ height: "0.85em", width: "60%", borderRadius: 6, background: tokens.surface }} />
          </div>
        ))}
      </div>
      <p role="status" style={{ textAlign: "center", fontFamily: tokens.assistant, fontWeight: 700, fontSize: "1rem", color: tokens.accent, margin: "1.2rem 0 0" }}>
        <span className="kt-spinner" aria-hidden="true" /> טוענים עוד מוצרים…
        {total > 0 && left > 0 && (
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.9rem", color: tokens.body, marginTop: "0.3rem" }}>
            מוצגים {shown.toLocaleString("he-IL")} מתוך {total.toLocaleString("he-IL")} — עוד {left.toLocaleString("he-IL")} בדרך, המשיכו לגלול ⬇
          </span>
        )}
      </p>
    </div>
  );
}
