"use client";

// Manager screen: every person registered in the system, searchable.
//
// There was no way to see the customer list at all. The price screen loads
// customers, but only inside its own dialog and only to tick boxes — the owner
// could not answer "who is registered?", "what is this shop's phone number?" or
// "has this customer ever ordered?" without opening the Supabase dashboard.
//
// Read-only on purpose. Editing a customer's discount, role or address changes
// what he is charged and what he can see, so it stays out of a browse screen
// until it is asked for deliberately.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { tokens, ils } from "../../../lib/ui";
import { normalizeHe } from "../../../lib/searchRank";

type Person = {
  id: string;
  email: string | null;
  full_name: string | null;
  business_name: string | null;
  phone: string | null;
  role: string | null;
  created_at: string;
  vat_number: string | null;
  discount_percent: number | string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  zip_code: string | null;
  delivery_notes: string | null;
  rivhit_customer_id: number | null;
};

type OrderStat = { orders: number; total: number; last: string | null };

const COLS =
  "id,email,full_name,business_name,phone,role,created_at,vat_number,discount_percent,city,street,house_number,zip_code,delivery_notes,rivhit_customer_id";

/** Everything about a person that is worth matching a search against, folded
 *  the same way the catalogue folds product names (final letters, punctuation,
 *  case) so "אבי" finds "אב״י" and a phone typed with dashes still matches. */
function haystack(p: Person): string {
  return normalizeHe(
    [p.business_name, p.full_name, p.email, p.phone, p.vat_number, p.city, p.street, p.rivhit_customer_id]
      .filter(Boolean)
      .join(" ")
  );
}

function addressOf(p: Person): string {
  const line = [p.street, p.house_number].filter(Boolean).join(" ");
  return [line, p.city, p.zip_code].filter(Boolean).join(", ");
}

function dateHe(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("he-IL");
}

export default function CustomersAdminPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  const [people, setPeople] = useState<Person[]>([]);
  const [stats, setStats] = useState<Map<string, OrderStat>>(new Map());
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

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

  // Debounced so typing does not re-filter on every keystroke once the list is
  // long — same 350ms the catalogue uses.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  const load = useCallback(async () => {
    if (!isManager) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("profiles")
      .select(COLS)
      .order("business_name", { nullsFirst: false });
    if (!mountedRef.current) return;
    if (error) { setErr("טעינת הלקוחות נכשלה. בדקו את החיבור ונסו שוב."); setBusy(false); return; }
    setErr("");
    setPeople((data as Person[]) ?? []);

    // Order history per person. The manager can already read every order on
    // /admin, so this adds no access — it just saves him from cross-checking
    // two screens to answer "did this customer ever order?".
    const { data: orders } = await supabase
      .from("orders")
      .select("user_id,total,created_at,status");
    if (!mountedRef.current) return;
    const m = new Map<string, OrderStat>();
    for (const o of ((orders ?? []) as { user_id: string | null; total: number | string | null; created_at: string; status: string | null }[])) {
      if (!o.user_id) continue;
      // A cancelled order is not business done — count it in neither.
      if (o.status === "cancelled") continue;
      const prev = m.get(o.user_id) ?? { orders: 0, total: 0, last: null };
      m.set(o.user_id, {
        orders: prev.orders + 1,
        total: prev.total + (Number(o.total) || 0),
        last: !prev.last || o.created_at > prev.last ? o.created_at : prev.last,
      });
    }
    setStats(m);
    setBusy(false);
  }, [isManager]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = normalizeHe(query);
    if (!q) return people;
    const words = q.split(" ").filter(Boolean);
    // Every word has to appear somewhere, in any order — so "אבי תל אביב"
    // finds the right shop even though the words come from three fields.
    return people.filter((p) => {
      const h = haystack(p);
      return words.every((w) => h.includes(w));
    });
  }, [people, query]);

  const customerCount = people.filter((p) => p.role !== "manager").length;

  if (loading || !isManager) return null;

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>
          <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> · לקוחות
        </div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
          לקוחות
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", maxWidth: 720 }}>
          כל מי שרשום במערכת. אפשר לחפש לפי שם העסק, שם איש הקשר, אימייל, טלפון, ח״פ או עיר —
          ולפתוח כרטיס לקוח כדי לראות את כתובת המשלוח, ההנחה הקבועה וההזמנות שלו.
        </p>

        <div style={{ position: "sticky", top: "var(--kt-header-h, 96px)", zIndex: 40, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "1rem 0", marginTop: "0.5rem" }}>
          <input
            type="search"
            aria-label="חיפוש לקוח (שם עסק / איש קשר / אימייל / טלפון / ח״פ / עיר)"
            placeholder="🔍 חיפוש לקוח…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.85rem 1rem", borderRadius: 14, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
          />
          <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginTop: "0.5rem" }}>
            {busy
              ? "טוען…"
              : query
                ? `${shown.length.toLocaleString("he-IL")} מתוך ${people.length.toLocaleString("he-IL")}`
                : `${customerCount.toLocaleString("he-IL")} לקוחות רשומים`}
          </p>
        </div>

        {err && (
          <div style={{ marginTop: "1rem" }}>
            <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.6rem" }}>{err}</p>
            <button onClick={load} style={miniBtn}>נסו שוב</button>
          </div>
        )}

        {!busy && !err && shown.length === 0 && (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
            {query ? `לא נמצא לקוח עבור “${query}”.` : "עוד לא נרשם אף לקוח."}
          </p>
        )}

        <div style={{ display: "grid", gap: "0.7rem", marginTop: "1rem" }}>
          {shown.map((p) => {
            const st = stats.get(p.id);
            const discount = Number(p.discount_percent) || 0;
            const open = openId === p.id;
            const title = p.business_name || p.full_name || p.email || "לקוח";
            return (
              <div key={p.id} style={{ border: `1px solid ${open ? tokens.accent : tokens.border}`, borderRadius: 16, background: "#fff", padding: "0.9rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 190 }}>
                    <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: tokens.text }}>
                      {title}
                      {p.role === "manager" && (
                        <span style={{ marginInlineStart: "0.5rem", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.65rem", color: "#fff", background: tokens.accent, padding: "0.12rem 0.45rem", borderRadius: 999 }}>מנהל</span>
                      )}
                    </div>
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>
                      {p.business_name && p.full_name ? `${p.full_name} · ` : ""}
                      <span dir="ltr">{p.phone || "בלי טלפון"}</span>
                    </div>
                  </div>
                  {discount > 0 && (
                    <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.75rem", color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 999, padding: "0.2rem 0.6rem" }}>
                      הנחה קבועה {discount}%
                    </span>
                  )}
                  <span style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim, whiteSpace: "nowrap" }}>
                    {st ? `${st.orders.toLocaleString("he-IL")} הזמנות · ${ils(st.total)}` : "עוד לא הזמין"}
                  </span>
                  <button
                    onClick={() => setOpenId(open ? null : p.id)}
                    aria-expanded={open}
                    style={{ ...miniBtn, minHeight: 44, background: open ? tokens.accent : "#fff", color: open ? "#fff" : tokens.text }}
                  >
                    {open ? "סגירה" : "פרטים"}
                  </button>
                </div>

                {open && (
                  <dl style={{ borderTop: `1px solid ${tokens.border}`, marginTop: "0.8rem", paddingTop: "0.8rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.7rem 1.2rem" }}>
                    <Row label="אימייל" value={p.email} ltr />
                    <Row label="טלפון" value={p.phone} ltr />
                    <Row label="ח״פ / ע״מ" value={p.vat_number} ltr />
                    <Row label="כתובת למשלוח" value={addressOf(p) || null} />
                    <Row label="הערות למשלוח" value={p.delivery_notes} />
                    <Row label="נרשם בתאריך" value={dateHe(p.created_at)} />
                    <Row label="הזמנה אחרונה" value={st?.last ? dateHe(st.last) : "—"} />
                    <Row label="מספר לקוח ברווחית" value={p.rivhit_customer_id ? String(p.rivhit_customer_id) : "לא מקושר"} ltr={!!p.rivhit_customer_id} />
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null | undefined; ltr?: boolean }) {
  return (
    <div>
      <dt style={{ fontFamily: tokens.assistant, fontSize: "0.75rem", color: tokens.dim }}>{label}</dt>
      <dd
        {...(ltr && value ? { dir: "ltr" as const } : {})}
        style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: value ? tokens.text : tokens.dim, margin: 0, wordBreak: "break-word", textAlign: ltr && value ? "right" : undefined }}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  fontFamily: tokens.rubik,
  fontWeight: 700,
  fontSize: "0.85rem",
  color: tokens.text,
  background: "#fff",
  border: `1px solid ${tokens.border}`,
  padding: "0.5rem 1rem",
  borderRadius: 999,
  cursor: "pointer",
};
