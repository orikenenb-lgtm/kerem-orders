// The bottom of a product grid while more products are on their way.
//
// The owner: customers scroll a category, reach the end of what has loaded so
// far, see a small grey "טוען עוד מוצרים…" and think the category is over. So
// the tail now LOOKS like the list goes on — a row of placeholder cards in the
// same grid — and says plainly how many products there are and that the rest
// is coming. Used by the store (/catalog), the public catalogue (/view,
// /prices) and custom catalogues (/collection).

import s from "./LoadMoreTail.module.css";

export default function LoadMoreTail({ shown, total, columns }: { shown: number; total: number; columns: string }) {
  const left = Math.max(0, total - shown);
  return (
    <div className={s.tail}>
      <div aria-hidden="true" className={s.grid} style={{ gridTemplateColumns: columns }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={s.skel}>
            <div className={s.img} />
            <div className={s.line} />
            <div className={`${s.line} ${s.short}`} />
          </div>
        ))}
      </div>
      <p role="status" className={s.status}>
        <span className={s.pill}>
          <span className="kt-spinner" aria-hidden="true" /> טוענים עוד מוצרים…
        </span>
        {total > 0 && left > 0 && (
          <span className={s.sub}>
            מוצגים {shown.toLocaleString("he-IL")} מתוך {total.toLocaleString("he-IL")} — עוד {left.toLocaleString("he-IL")} בדרך, המשיכו לגלול ⬇
          </span>
        )}
      </p>
    </div>
  );
}
