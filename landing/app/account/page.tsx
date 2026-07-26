"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { StatusBadge } from "../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { tokens, ils } from "../../lib/ui";

type OrderItem = { id: string; product_name: string; unit_price: number; quantity: number };
type Order = {
  id: string;
  status: string;
  total: number;
  note: string;
  created_at: string;
  order_items: OrderItem[];
};

export default function AccountPage() {
  const router = useRouter();
  const { session, profile, loading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(false);
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false });
    if (error) {
      // A fetch failure is NOT an empty history — show an error + retry
      // instead of "עוד לא ביצעתם הזמנות".
      setErr(true);
      setBusy(false);
      return;
    }
    setOrders((data as Order[]) ?? []);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ maxWidth: 860, margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem) clamp(1rem,4vw,2.5rem)" }}>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.8rem,4vw,2.6rem)", color: tokens.text }}>
          ההזמנות שלי
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", marginBottom: "2rem" }}>
          {profile?.business_name ? `${profile.business_name} · ` : ""}היסטוריית ההזמנות שלכם.
        </p>

        {busy ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען…</p>
        ) : err ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", border: `1px dashed ${tokens.border}`, borderRadius: 18 }}>
            <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "1rem" }}>טעינת ההזמנות נכשלה. בדקו את החיבור ונסו שוב.</p>
            <button onClick={load} style={{ fontFamily: tokens.rubik, fontWeight: 700, color: "#fff", background: tokens.rainbow, padding: "0.7rem 1.5rem", borderRadius: 999, border: "none", cursor: "pointer" }}>
              נסו שוב
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", border: `1px dashed ${tokens.border}`, borderRadius: 18 }}>
            <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "1rem" }}>עוד לא ביצעתם הזמנות.</p>
            <Link href="/catalog" style={{ fontFamily: tokens.rubik, fontWeight: 700, color: "#fff", background: tokens.rainbow, padding: "0.7rem 1.5rem", borderRadius: 999, textDecoration: "none" }}>
              לקטלוג
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {orders.map((o) => (
              <div key={o.id} style={{ border: `1px solid ${tokens.border}`, borderRadius: 16, padding: "1.2rem", background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.8rem" }}>
                  <div style={{ fontFamily: tokens.assistant, color: tokens.dim, fontSize: "0.85rem" }}>
                    <span dir="ltr">#{o.id.slice(0, 8)}</span> · {new Date(o.created_at).toLocaleDateString("he-IL")}
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div style={{ display: "grid", gap: "0.3rem", marginBottom: "0.8rem" }}>
                  {o.order_items?.map((it) => (
                    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body }}>
                      <span>{it.product_name} × {it.quantity}</span>
                      <span>{ils(it.unit_price * it.quantity)}</span>
                    </div>
                  ))}
                </div>
                {o.note && <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.6rem" }}>הערה: {o.note}</p>}
                <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: "0.6rem", display: "flex", justifyContent: "space-between", fontFamily: tokens.rubik, fontWeight: 800, color: tokens.text }}>
                  <span>סה״כ</span>
                  <span>{ils(o.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

