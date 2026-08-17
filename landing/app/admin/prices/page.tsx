"use client";

// Manager screen: set a price for EVERYONE or for CHOSEN CUSTOMERS.
//
// Why prices are not edited on the product row: the Rivhit sync upserts
// products.price from Item.List every 15 minutes, so a manual edit there is
// silently reverted. Everything here writes to price_overrides, which the
// sync never touches. The rules (customer price beats global; a customer
// price is final and the fixed discount is NOT added on top) live in
// lib/pricing.ts and, identically, in the validate_order_item DB trigger.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import ProductImage from "../../components/ProductImage";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { tokens, ils } from "../../../lib/ui";

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  picture_link: string;
  rotation_override: number | null;
};

type OverrideRow = {
  id: string;
  product_id: string;
  user_id: string | null;
  price: number;
  updated_at: string;
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

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [ovBusy, setOvBusy] = useState(false);

  // editor state
  const [scope, setScope] = useState<"all" | "some">("all");
  const [newPrice, setNewPrice] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

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

  // customer list once (for the "chosen customers" picker)
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

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const s = query.trim();
      if (s.length < 2) { setResults([]); return; }
      setSearching(true);
      const { data } = await supabase
        .from("products")
        .select("id,name,sku,price,picture_link,rotation_override")
        .eq("is_active", true)
        .or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`)
        .order("name")
        .limit(15);
      if (cancelled || !mountedRef.current) return;
      setSearching(false);
      setResults((data as ProductRow[]) ?? []);
    };
    run();
    return () => { cancelled = true; };
  }, [query]);

  const loadOverrides = useCallback(async (productId: string) => {
    setOvBusy(true);
    const { data, error } = await supabase
      .from("price_overrides")
      .select("id,product_id,user_id,price,updated_at")
      .eq("product_id", productId);
    if (!mountedRef.current) return;
    setOvBusy(false);
    if (error) { setErr("טעינת המחירים נכשלה."); return; }
    setOverrides((data as OverrideRow[]) ?? []);
  }, []);

  const pick = (p: ProductRow) => {
    setSelected(p);
    setOverrides([]);
    setNewPrice("");
    setScope("all");
    setPicked(new Set());
    setErr("");
    setNotice("");
    loadOverrides(p.id);
  };

  const priceNum = Number(newPrice);
  const priceValid = newPrice.trim() !== "" && Number.isFinite(priceNum) && priceNum >= 0;

  const save = async () => {
    if (!selected || !priceValid || saving) return;
    if (scope === "some" && picked.size === 0) {
      setErr("בחרו לפחות לקוח אחד, או עברו ל״לכל הלקוחות״.");
      return;
    }
    setSaving(true);
    setErr("");
    const rounded = Math.round(priceNum * 100) / 100;
    // user_id null = "everyone"; a uuid = that one customer. Typed as the
    // union up front so the ternary doesn't collapse to the string-only shape.
    const rows: { product_id: string; user_id: string | null; price: number; updated_by: string | null }[] =
      scope === "all"
        ? [{ product_id: selected.id, user_id: null, price: rounded, updated_by: session?.user.id ?? null }]
        : [...picked].map((uid) => ({
            product_id: selected.id, user_id: uid, price: rounded, updated_by: session?.user.id ?? null,
          }));
    // The unique indexes are partial (one WHERE user_id IS NULL, one WHERE it
    // is not), which upsert's ON CONFLICT cannot target — so replace instead:
    // delete the rows being rewritten, then insert.
    let delQ = supabase.from("price_overrides").delete().eq("product_id", selected.id);
    delQ = scope === "all" ? delQ.is("user_id", null) : delQ.in("user_id", [...picked]);
    const { error: delErr } = await delQ;
    if (delErr) { setSaving(false); setErr("שמירת המחיר נכשלה."); return; }
    const { error } = await supabase.from("price_overrides").insert(rows);
    if (!mountedRef.current) return;
    setSaving(false);
    if (error) { setErr("שמירת המחיר נכשלה."); return; }
    setNotice(
      scope === "all"
        ? `המחיר ${ils(rounded)} נשמר לכל הלקוחות.`
        : `המחיר ${ils(rounded)} נשמר ל־${picked.size} לקוחות.`
    );
    setNewPrice("");
    setPicked(new Set());
    loadOverrides(selected.id);
  };

  const removeOverride = async (o: OverrideRow) => {
    const { error } = await supabase.from("price_overrides").delete().eq("id", o.id);
    if (error) { setErr("הביטול נכשל."); return; }
    setNotice("המחיר בוטל — חזרה למחיר מרווחית.");
    if (selected) loadOverrides(selected.id);
  };

  if (loading || !isManager) return null;

  const globalOv = overrides.find((o) => o.user_id === null) ?? null;
  const customerOvs = overrides.filter((o) => o.user_id !== null);
  const customerName = (id: string) => {
    const c = customers.find((x) => x.id === id);
    return c?.business_name || c?.full_name || "לקוח";
  };

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>
          <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> · מחירים
        </div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
          שינוי מחירים
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", maxWidth: 700 }}>
          מחפשים מוצר, קובעים מחיר, ובוחרים אם הוא חל <strong>על כל הלקוחות</strong> או <strong>על לקוחות מסוימים</strong>.
          המחיר נשמר בנפרד ממחיר רווחית, כך שהסנכרון האוטומטי לא מוחק אותו.
        </p>

        <input
          type="search"
          aria-label="חיפוש מוצר לשינוי מחיר"
          placeholder="🔍 חיפוש מוצר (שם / קוד / ברקוד)…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: "100%", marginTop: "1.2rem", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.8rem 1rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
        />
        {searching && <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginTop: "0.5rem" }}>מחפש…</p>}

        {results.length > 0 && (
          <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.7rem" }}>
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => pick(p)}
                style={{ display: "flex", alignItems: "center", gap: "0.7rem", textAlign: "start", font: "inherit", cursor: "pointer", border: `1px solid ${selected?.id === p.id ? tokens.accent : tokens.border}`, borderRadius: 12, padding: "0.5rem 0.7rem", background: "#fff" }}
              >
                <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                  <ProductImage pictureLink={p.picture_link} name={p.name} rotation={p.rotation_override ?? 0} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: tokens.assistant, fontWeight: 600, fontSize: "0.9rem", color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ display: "block", fontFamily: tokens.assistant, fontSize: "0.75rem", color: tokens.dim }}>
                    מחיר רווחית: {ils(p.price)}{p.sku ? ` · ${p.sku}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div style={{ marginTop: "1.5rem", border: `1px solid ${tokens.border}`, borderRadius: 16, background: "#fff", padding: "1.1rem" }}>
            <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>{selected.name}</div>
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, marginTop: "0.2rem" }}>
              מחיר מרווחית (ברירת מחדל): <strong>{ils(selected.price)}</strong>
            </div>

            {/* current state */}
            <div style={{ marginTop: "1rem", display: "grid", gap: "0.4rem" }}>
              {ovBusy ? (
                <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>טוען מחירים…</span>
              ) : (
                <>
                  {globalOv && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "rgba(37,199,126,0.10)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 10, padding: "0.5rem 0.7rem" }}>
                      <span style={{ flex: 1, fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.text }}>
                        לכל הלקוחות: <strong>{ils(globalOv.price)}</strong> <span style={{ color: tokens.dim }}>(ההנחה הקבועה של הלקוח עדיין חלה על זה)</span>
                      </span>
                      <button onClick={() => removeOverride(globalOv)} style={miniBtn}>ביטול</button>
                    </div>
                  )}
                  {customerOvs.map((o) => (
                    <div key={o.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.5rem 0.7rem" }}>
                      <span style={{ flex: 1, fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.text }}>
                        {customerName(o.user_id!)}: <strong>{ils(o.price)}</strong> <span style={{ color: tokens.dim }}>(מחיר סופי)</span>
                      </span>
                      <button onClick={() => removeOverride(o)} style={miniBtn}>ביטול</button>
                    </div>
                  ))}
                  {!globalOv && customerOvs.length === 0 && (
                    <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>
                      אין כרגע מחיר מיוחד — כולם משלמים את מחיר רווחית (בניכוי ההנחה הקבועה שלהם).
                    </span>
                  )}
                </>
              )}
            </div>

            {/* editor */}
            <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: "1rem", paddingTop: "1rem", display: "grid", gap: "0.8rem" }}>
              <label style={{ display: "grid", gap: "0.3rem", maxWidth: 240 }}>
                <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.text }}>מחיר חדש (₪)</span>
                <input
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="לדוגמה: 12.50"
                  style={{ fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.65rem 0.8rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
                />
              </label>

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
                <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, padding: "0.6rem", maxHeight: 260, overflowY: "auto", display: "grid", gap: "0.25rem" }}>
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
                        <span style={{ fontSize: "0.75rem", color: tokens.dim }}>· הנחה קבועה {Number(c.discount_percent)}% (לא תתווסף למחיר הזה)</span>
                      )}
                    </label>
                  ))}
                </div>
              )}

              {err && <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", fontSize: "0.9rem", margin: 0 }}>{err}</p>}
              {notice && <p role="status" style={{ fontFamily: tokens.assistant, color: "#1A7A4D", fontSize: "0.9rem", margin: 0 }}>{notice}</p>}

              <button
                onClick={save}
                disabled={!priceValid || saving}
                style={{ justifySelf: "start", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.75rem 1.6rem", borderRadius: 999, cursor: "pointer", opacity: !priceValid || saving ? 0.6 : 1 }}
              >
                {saving ? "שומר…" : "שמירת המחיר"}
              </button>
            </div>
          </div>
        )}
      </main>
    </>
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
