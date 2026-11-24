"use client";

// The item card: what was scanned, what Rivhit says, and the one big number
// the manager types. A re-scan of an already-counted item must be answered
// explicitly — "החלפת הכמות" or "הוספה לכמות" — so nothing is doubled silently.

import { useEffect, useRef } from "react";
import ProductImage from "../../../components/ProductImage";
import { tokens } from "../../../../lib/ui";
import { formatWhen, parseCount, resolveTotal } from "../../../../lib/inventory";
import type { Line, Product } from "./api";
import { useQtyBurstGuard } from "./WedgeInput";
import { bigBtn, card, ERR, field, labelStyle, note, secondaryBtn, WARN } from "./styles";

export type SaveMode = "replace" | "add";

export default function ItemCard({
  product, existing, recount, qty, setQty, mode, setMode, saving, onSave, onCancel, onEdit, onBurst,
}: {
  product: Product;
  existing: Line | null;
  /** A recount of a line whose Rivhit stock moved: replace only. */
  recount: boolean;
  qty: string;
  setQty: (v: string) => void;
  mode: SaveMode | null;
  setMode: (m: SaveMode) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onBurst: (code: string, rest: string) => void;
}) {
  const qtyRef = useRef<HTMLInputElement | null>(null);

  // Autofocus + select the quantity whenever a different product opens.
  useEffect(() => {
    const el = qtyRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [product.product_id]);

  const onKeyDown = useQtyBurstGuard({
    getValue: () => qtyRef.current?.value ?? qty,
    setValue: setQty,
    onBurst,
    onEnter: onSave,
  });

  const parsed = qty.trim() ? parseCount(qty) : null;
  const total = parsed?.ok && mode ? resolveTotal(mode, existing?.counted_qty, parsed.value) : null;
  const needChoice = !!existing && !recount && mode === null;
  const pack = Number(product.display_qty) > 1 ? Number(product.display_qty) : 0;
  const unit = product.unit_name || "יח'";
  const codes = [product.sku, product.barcode].filter((c, i, a) => c && a.indexOf(c) === i) as string[];

  return (
    <section aria-label={`פריט: ${product.name}`} data-testid="inv-item-card" style={{ ...card, borderColor: "rgba(138,63,252,0.35)", boxShadow: "0 6px 20px rgba(26,23,48,0.07)", display: "grid", gap: "0.85rem" }}>
      <div style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
        <div style={{ width: 88, height: 88, flex: "0 0 88px", borderRadius: 12, overflow: "hidden", background: tokens.surface }}>
          <ProductImage pictureLink={product.picture_link} name={product.name} width={480} rotation={product.rotation_override}
            imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} priority />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.15rem", color: tokens.text, margin: 0, lineHeight: 1.3, overflowWrap: "anywhere" }}>{product.name}</h2>
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.body, marginTop: "0.25rem", overflowWrap: "anywhere" }}>
            {codes.length ? codes.map((c, i) => (
              <span key={c}>{i > 0 ? " · " : ""}{i === 0 ? "מק״ט " : "ברקוד "}<span dir="ltr">{c}</span></span>
            )) : "בלי ברקוד"}
          </div>
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.text, marginTop: "0.35rem" }}>
            כמות רשומה ברווחית: <strong>{Number(product.stock_quantity ?? 0).toLocaleString("he-IL")}</strong>{" "}
            <span style={{ color: tokens.dim, fontSize: "0.8rem" }}>(נכון ל-{formatWhen(product.updated_at)})</span>
          </div>
          {pack > 0 && (
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: WARN, marginTop: "0.2rem" }}>
              {product.display_name || "מארז"} = {pack.toLocaleString("he-IL")} יח׳ — סופרים ביחידות
            </div>
          )}
        </div>
      </div>

      {recount && (
        <p role="note" style={{ ...note, color: WARN }}>
          ספירה חוזרת: המלאי ברווחית השתנה מאז הספירה הקודמת. הזינו את מה שיש על המדף עכשיו — זה יחליף את הכמות הקודמת.
        </p>
      )}

      {existing && !recount && (
        <div role="group" aria-label="הפריט כבר נספר — מה לעשות עם הכמות החדשה?" style={{ display: "grid", gap: "0.5rem", background: "rgba(180,83,9,0.06)", border: "1px solid rgba(180,83,9,0.3)", borderRadius: 12, padding: "0.7rem" }}>
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.text }}>
            כבר נספר: <strong data-testid="inv-saved-qty">{existing.counted_qty.toLocaleString("he-IL")}</strong> {unit}
            <span style={{ color: tokens.dim, fontSize: "0.82rem" }}> · {formatWhen(existing.counted_at)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            {(["replace", "add"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); qtyRef.current?.focus(); }}
                style={{ ...secondaryBtn, borderRadius: 12, padding: "0.5rem", border: mode === m ? `2px solid ${tokens.accent}` : `1px solid ${tokens.border}`, background: mode === m ? "rgba(138,63,252,0.08)" : "#fff" }}>
                {m === "replace" ? "החלפת הכמות" : "הוספה לכמות"}
              </button>
            ))}
          </div>
          {mode === null && <span style={{ ...note, color: WARN }}>בחרו: להחליף את הכמות השמורה, או להוסיף אליה.</span>}
        </div>
      )}

      <label style={labelStyle}>
        {mode === "add" ? "כמות להוספה" : "כמות שנספרה"} ({unit})
        <input
          ref={qtyRef}
          data-testid="inv-qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={onKeyDown}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          dir="ltr"
          aria-invalid={parsed ? !parsed.ok : undefined}
          aria-describedby="inv-qty-help"
          style={{ ...field, fontSize: "2rem", fontWeight: 800, textAlign: "center", minHeight: 64, fontFamily: tokens.rubik }}
        />
      </label>
      <div id="inv-qty-help" aria-live="polite" style={{ fontFamily: tokens.assistant, fontSize: "0.92rem", minHeight: "1.3em" }}>
        {parsed && !parsed.ok ? <span style={{ color: ERR }}>{parsed.error}</span>
          : total && !total.ok ? <span style={{ color: ERR }}>{total.error}</span>
          : mode === "add" && parsed?.ok && total?.ok ? (
            <span data-testid="inv-add-total" style={{ color: tokens.text }}>
              סה״כ אחרי השמירה: <span dir="ltr">{existing?.counted_qty.toLocaleString("he-IL")} + {parsed.value.toLocaleString("he-IL")}</span> = <strong>{total.value.toLocaleString("he-IL")}</strong>
            </span>
          ) : pack > 0 && parsed?.ok && parsed.value > 0 ? (
            <span style={{ color: tokens.dim }}>≈ {(parsed.value / pack).toLocaleString("he-IL", { maximumFractionDigits: 1 })} {product.display_name || "מארזים"}</span>
          ) : null}
      </div>

      <button type="button" onClick={onSave} disabled={saving || needChoice} style={bigBtn(saving || needChoice)}>
        {saving ? "שומר…" : "שמור והמשך"}
      </button>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" onClick={onCancel} disabled={saving} style={{ ...secondaryBtn, flex: 1 }}>ביטול</button>
        <button type="button" onClick={onEdit} disabled={saving} style={{ ...secondaryBtn, flex: 1, color: tokens.body }}>עריכת פריט</button>
      </div>
    </section>
  );
}
