"use client";

// Manager screen: browse the WHOLE catalogue exactly like the customer sees it
// (grid, categories, search, infinite scroll) and change the price of any
// product — for everyone, or for chosen customers.
//
// Why prices are not edited on the product row: the Rivhit sync upserts
// products.price from Item.List every 15 minutes, so a manual edit there is
// silently reverted. Everything here writes to price_overrides, which the sync
// never touches. The resolution rules (a customer price beats the global one
// and is final — the fixed discount is NOT added on top) live in
// lib/pricing.ts and, identically, in the validate_order_item DB trigger.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import AdminProductBrowser, { type BrowserProduct } from "../components/AdminProductBrowser";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { tokens, ils } from "../../../lib/ui";

type ProductRow = BrowserProduct;

type OverrideRow = {
  id: string;
  product_id: string;
  user_id: string | null;
  price: number;
};

type CustomerRow = {
  id: string;
  full_name: string | null;
  business_name: string | null;
  discount_percent: number | string | null;
};

export default function PricesAdminPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  // ── prices ──
  // product_id → { global?: OverrideRow; customers: OverrideRow[] }
  const [ovMap, setOvMap] = useState<Map<string, { global?: OverrideRow; customers: OverrideRow[] }>>(new Map());
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager) router.replace("/catalog");
  }, [loading, session, isManager, router]);

  // categories + customers, once
  useEffect(() => {
    if (!isManager) return;
    supabase
      .from("profiles")
      .select("id,full_name,business_name,discount_percent")
      .eq("role", "customer")
      .order("business_name")
      .then(({ data }) => {
        if (mountedRef.current) setCustomers((data as CustomerRow[]) ?? []);
      });
  }, [isManager]);

  // Every override in one read, indexed by product — the grid needs to badge
  // any card that already has a price, not just the one being edited.
  const loadOverrides = useCallback(async () => {
    const { data, error } = await supabase
      .from("price_overrides")
      .select("id,product_id,user_id,price");
    if (!mountedRef.current || error) return;
    const m = new Map<string, { global?: OverrideRow; customers: OverrideRow[] }>();
    for (const o of (data as OverrideRow[]) ?? []) {
      const e = m.get(o.product_id) ?? { customers: [] };
      if (o.user_id === null) e.global = o;
      else e.customers.push(o);
      m.set(o.product_id, e);
    }
    setOvMap(m);
  }, []);

  useEffect(() => { if (isManager) loadOverrides(); }, [isManager, loadOverrides]);

  const customerName = useCallback((id: string) => {
    const c = customers.find((x) => x.id === id);
    return c?.business_name || c?.full_name || "לקוח";
  }, [customers]);

  if (loading || !isManager) return null;

  const pricedCount = ovMap.size;

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>
          <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> · מחירים
        </div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
          שינוי מחירים
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", maxWidth: 720 }}>
          כל המוצרים באתר. לוחצים ״שינוי מחיר״ על מוצר, קובעים מחיר, ובוחרים אם הוא חל{" "}
          <strong>על כל הלקוחות</strong> או <strong>על לקוחות מסוימים</strong>.
          המחיר נשמר בנפרד ממחיר רווחית, כך שהסנכרון האוטומטי לא מוחק אותו.
        </p>
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim, fontSize: "0.88rem", marginTop: "0.3rem" }}>
          {total.toLocaleString("he-IL")} מוצרים
          {pricedCount > 0 ? ` · ${pricedCount.toLocaleString("he-IL")} מהם עם מחיר מיוחד` : ""}
        </p>

        {notice && <p role="status" style={{ fontFamily: tokens.assistant, color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 10, padding: "0.5rem 0.8rem" }}>{notice}</p>}
        {err && <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C" }}>{err}</p>}

        <AdminProductBrowser
          searchLabel="חיפוש מוצר (שם / קוד / ברקוד)"
          onTotal={setTotal}
          highlight={(p) => ovMap.has(p.id)}
          renderAction={(p) => {
            const ov = ovMap.get(p.id);
            return (
              <>
                {ov?.global ? (
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", color: "#1A7A4D" }}>{ils(ov.global.price)}</span>
                    <s style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim }}>{ils(p.price)}</s>
                    <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.65rem", color: "#fff", background: "#1A7A4D", padding: "0.12rem 0.45rem", borderRadius: 999 }}>לכולם</span>
                  </div>
                ) : (
                  <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", color: tokens.text }}>{ils(p.price)}</div>
                )}
                {ov && ov.customers.length > 0 && (
                  <div style={{ fontFamily: tokens.assistant, fontSize: "0.75rem", color: "#1A7A4D" }}>
                    מחיר מיוחד ל־{ov.customers.length.toLocaleString("he-IL")} לקוחות
                  </div>
                )}
                <button
                  onClick={() => { setEditing(p); setNotice(""); setErr(""); }}
                  style={{ marginTop: "auto", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: "#fff", background: tokens.accent, border: "none", padding: "0.55rem 0.9rem", borderRadius: 12, cursor: "pointer", width: "100%" }}
                >
                  שינוי מחיר
                </button>
              </>
            );
          }}
        />
      </main>

      {editing && (
        <PriceEditor
          product={editing}
          existing={ovMap.get(editing.id) ?? { customers: [] }}
          customers={customers}
          customerName={customerName}
          managerId={session?.user.id ?? null}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setNotice(msg); loadOverrides(); }}
          onError={(msg) => setErr(msg)}
        />
      )}
      <SiteFooter />
    </>
  );
}

// Focused editor dialog: price + who it applies to + the prices already set.
function PriceEditor({ product, existing, customers, customerName, managerId, onClose, onSaved, onError }: {
  product: ProductRow;
  existing: { global?: OverrideRow; customers: OverrideRow[] };
  customers: CustomerRow[];
  customerName: (id: string) => string;
  managerId: string | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [scope, setScope] = useState<"all" | "some">("all");
  const [newPrice, setNewPrice] = useState("");
  // Seed from the customers who already have a price on this product: an empty
  // set meant the manager had to re-pick from memory, and anyone they forgot
  // silently kept their old price (the delete is scoped to `picked`).
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set((existing?.customers ?? []).map((o) => o.user_id!).filter(Boolean))
  );
  const [saving, setSaving] = useState(false);
  const [localErr, setLocalErr] = useState("");
  const [confirmFree, setConfirmFree] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])'
        );
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1], active = document.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        else if (!panelRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const priceNum = Number(newPrice);
  const priceValid = newPrice.trim() !== "" && Number.isFinite(priceNum) && priceNum >= 0;
  // A price of 0 makes the product free, and the order trigger accepts it, so
  // nothing downstream would catch a slip. Anything under an agora rounds to 0
  // too. Both need the manager to say so out loud.
  const wouldBeFree = priceValid && Math.round(priceNum * 100) / 100 === 0;
  // A price wildly above the Rivhit list price is almost always a typo (a
  // missing decimal point). Warn, but never block — a real repricing is legal.
  const listPrice = Number(product.price) || 0;
  const suspiciouslyHigh = priceValid && listPrice > 0 && priceNum > listPrice * 5;

  const save = async () => {
    if (!priceValid || saving) return;
    if (wouldBeFree && !confirmFree) {
      setLocalErr("מחיר 0 יהפוך את המוצר לחינם. סמנו את האישור אם זו הכוונה.");
      return;
    }
    if (scope === "some" && picked.size === 0) {
      setLocalErr("בחרו לפחות לקוח אחד, או עברו ל״כל הלקוחות״.");
      return;
    }
    setSaving(true);
    setLocalErr("");
    const rounded = Math.round(priceNum * 100) / 100;
    const rows: { product_id: string; user_id: string | null; price: number; updated_by: string | null }[] =
      scope === "all"
        ? [{ product_id: product.id, user_id: null, price: rounded, updated_by: managerId }]
        : [...picked].map((uid) => ({ product_id: product.id, user_id: uid, price: rounded, updated_by: managerId }));
    // The unique indexes are partial (one WHERE user_id IS NULL, one WHERE it
    // is not), which upsert's ON CONFLICT cannot target — so replace instead.
    let del = supabase.from("price_overrides").delete().eq("product_id", product.id);
    del = scope === "all" ? del.is("user_id", null) : del.in("user_id", [...picked]);
    const { error: delErr } = await del;
    if (delErr) { setSaving(false); setLocalErr("השמירה נכשלה — שום דבר לא השתנה."); return; }
    const { error } = await supabase.from("price_overrides").insert(rows);
    setSaving(false);
    if (error) {
      // The delete already went through, so the old price is gone. Saying only
      // "save failed" would read as "nothing changed" — which is the opposite of
      // what happened. Say it plainly and reload so the screen stops showing a
      // price that no longer exists.
      setLocalErr("השמירה נכשלה והמחיר הקודם כבר הוסר. הזינו מחיר ושמרו שוב.");
      onError("השמירה נכשלה באמצע — המחיר הקודם הוסר. הזינו אותו מחדש.");
      return;
    }
    onSaved(
      scope === "all"
        ? `${product.name}: ${ils(rounded)} לכל הלקוחות.`
        : `${product.name}: ${ils(rounded)} ל־${picked.size} לקוחות.`
    );
    onClose();
  };

  const cancelOverride = async (o: OverrideRow) => {
    const { error } = await supabase.from("price_overrides").delete().eq("id", o.id);
    if (error) { onError("הביטול נכשל."); return; }
    onSaved("המחיר בוטל — חזרה למחיר מרווחית.");
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,16,32,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`שינוי מחיר: ${product.name}`}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", width: "100%", maxWidth: 520, maxHeight: "92dvh", overflowY: "auto", borderRadius: 20, padding: "1rem 1.1rem 1.4rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.8rem" }}>
          <div>
            <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", color: tokens.text }}>{product.name}</div>
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, marginTop: "0.2rem" }}>
              מחיר רווחית: <strong>{ils(product.price)}</strong>
            </div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="סגירה" style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, fontSize: "1.2rem", lineHeight: 1, cursor: "pointer" }}>✕</button>
        </div>

        {/* what is already set */}
        {(existing.global || existing.customers.length > 0) && (
          <div style={{ display: "grid", gap: "0.4rem" }}>
            {existing.global && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "rgba(37,199,126,0.10)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 10, padding: "0.5rem 0.7rem" }}>
                <span style={{ flex: 1, fontFamily: tokens.assistant, fontSize: "0.86rem", color: tokens.text }}>
                  לכל הלקוחות: <strong>{ils(existing.global.price)}</strong>{" "}
                  <span style={{ color: tokens.dim }}>(ההנחה הקבועה עדיין חלה על זה)</span>
                </span>
                <button onClick={() => cancelOverride(existing.global!)} style={miniBtn}>ביטול</button>
              </div>
            )}
            {existing.customers.map((o) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.5rem 0.7rem" }}>
                <span style={{ flex: 1, fontFamily: tokens.assistant, fontSize: "0.86rem", color: tokens.text }}>
                  {customerName(o.user_id!)}: <strong>{ils(o.price)}</strong>{" "}
                  <span style={{ color: tokens.dim }}>(מחיר סופי)</span>
                </span>
                <button onClick={() => cancelOverride(o)} style={miniBtn}>מחיקת המחיר</button>
              </div>
            ))}
          </div>
        )}

        <label style={{ display: "grid", gap: "0.3rem", maxWidth: 220 }}>
          <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.text }}>מחיר חדש (₪)</span>
          <input
            value={newPrice}
            // A comma must become a decimal point, not vanish: stripping it turned
            // "12,50" into 1250 — a 100x price — with the comma disappearing as you
            // typed, so nobody watching the keyboard would notice. Hebrew and Arabic
            // keyboards both put a comma next to the dot in the decimal keypad.
            onChange={(e) =>
              setNewPrice(
                e.target.value
                  .replace(/[\u066B\u060C,]/g, ".")
                  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
                  .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
                  .replace(/[^\d.]/g, "")
                  .replace(/^(\d*\.\d*).*$/, "$1")
              )
            }
            dir="ltr"
            inputMode="decimal"
            placeholder="לדוגמה: 12.50"
            style={{ fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.65rem 0.8rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
          />
        </label>

        {wouldBeFree && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: tokens.assistant, fontSize: "0.9rem", color: "#8A4A00", cursor: "pointer" }}>
            <input type="checkbox" checked={confirmFree} onChange={(e) => setConfirmFree(e.target.checked)} />
            אני מאשר/ת שהמוצר יהיה חינם (₪0) עבור מי שנבחר.
          </label>
        )}
        {suspiciouslyHigh && (
          <p role="status" style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: "#8A4A00", margin: 0 }}>
            ⚠ המחיר גבוה פי {Math.round(priceNum / listPrice)} מהמחיר ברווחית ({ils(listPrice)}). בדקו שלא חסרה נקודה עשרונית.
          </p>
        )}

        <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
          <legend style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.text, padding: 0 }}>על מי המחיר חל?</legend>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.body, cursor: "pointer" }}>
            <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} />
            על כל הלקוחות
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.body, cursor: "pointer" }}>
            <input type="radio" name="scope" checked={scope === "some"} onChange={() => setScope("some")} />
            על לקוחות מסוימים
          </label>
        </fieldset>

        {scope === "some" && (
          <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, padding: "0.6rem", maxHeight: 220, overflowY: "auto", display: "grid", gap: "0.25rem" }}>
            {customers.length === 0 ? (
              <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>אין עדיין לקוחות רשומים.</span>
            ) : customers.map((c) => (
              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.text, cursor: "pointer", padding: "0.25rem" }}>
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={(e) => setPicked((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(c.id); else n.delete(c.id);
                    return n;
                  })}
                />
                <span>{c.business_name || c.full_name || "לקוח"}</span>
                {Number(c.discount_percent) > 0 && (
                  <span style={{ fontSize: "0.72rem", color: tokens.dim }}>· הנחה {Number(c.discount_percent)}% (לא תתווסף)</span>
                )}
              </label>
            ))}
          </div>
        )}

        {localErr && <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", fontSize: "0.9rem", margin: 0 }}>{localErr}</p>}

        <button
          onClick={save}
          disabled={!priceValid || saving}
          style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.75rem 1.6rem", borderRadius: 999, cursor: "pointer", opacity: !priceValid || saving ? 0.6 : 1 }}
        >
          {saving ? "שומר…" : "שמירת המחיר"}
        </button>
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  fontFamily: tokens.rubik,
  fontWeight: 700,
  fontSize: "0.8rem",
  color: "#C0143C",
  background: "#fff",
  border: `1px solid ${tokens.border}`,
  padding: "0.35rem 0.8rem",
  borderRadius: 999,
  cursor: "pointer",
};
