"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { StatusBadge } from "../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { ils, discountPct } from "../../lib/ui";
import { readCart, CART_KEY } from "../../lib/cart";
import { buildPriceMap, resolvePrice, type PriceOverrideRow } from "../../lib/pricing";
import { resolveQuantity } from "../../lib/quantity";
import { featureFlags } from "../../lib/featureFlags";
import s from "./account.module.css";

const ffReorder = featureFlags.ff_reorder;
const ffQty = featureFlags.ff_display_quantities;

/** Mirrors the catalogue's CartLine — the shape /catalog reads back from
 *  localStorage. Kept structurally identical on purpose. */
type CartLine = {
  qty: number; name: string; price: number; sku: string | null; picture_link: string;
  display_qty?: number | null; display_name?: string | null;
};

type OrderItem = { id: string; product_id: string | null; product_name: string; unit_price: number; quantity: number };
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

  // "הזמן שוב" (ff_reorder): refill the cart from a past order.
  //
  // The stored order line's unit_price is deliberately IGNORED — a price from
  // weeks ago is not this customer's price today. Every line is re-resolved
  // through the same resolvePrice() the catalogue uses (per-customer override →
  // global override + discount → list price + discount), quantities are
  // re-normalised to whole packs, and anything no longer active is skipped and
  // named rather than silently dropped. Checkout still re-fetches and validates
  // every line, so even a stale write here cannot become a mispriced order.
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [reorderMsg, setReorderMsg] = useState("");
  // true when the reorder finished but something was unavailable, so we stayed
  // on the page and offer an explicit way to the cart instead of redirecting.
  const [reorderCta, setReorderCta] = useState(false);

  const reorder = async (o: Order) => {
    setReorderingId(o.id);
    setReorderMsg("");
    setReorderCta(false);
    try {
      const items = o.order_items ?? [];
      const ids = Array.from(new Set(items.map((it) => it.product_id).filter((x): x is string => !!x)));
      if (ids.length === 0) {
        setReorderMsg("אין בהזמנה הזאת מוצרים שאפשר להזמין שוב.");
        return;
      }
      const [{ data: prods, error: pErr }, { data: ovr }] = await Promise.all([
        supabase
          .from("products")
          .select("id,name,price,sku,picture_link,display_qty,display_name,min_order_qty,order_step,sell_by")
          .in("id", ids)
          .eq("is_active", true),
        supabase.from("price_overrides").select("product_id,user_id,price").in("product_id", ids),
      ]);
      if (pErr) throw pErr;

      const priceMap = buildPriceMap((ovr ?? []) as PriceOverrideRow[], session?.user.id ?? null);
      const d = discountPct(profile?.discount_percent);
      type Prod = { id: string; name: string; price: number | string; sku: string | null; picture_link: string | null;
        display_qty: number | null; display_name: string | null; min_order_qty: number | null;
        order_step: number | null; sell_by: string | null };
      const byId = new Map(((prods ?? []) as Prod[]).map((p) => [p.id, p]));

      const next = readCart<CartLine>(localStorage.getItem(CART_KEY));
      const gone: string[] = [];
      let added = 0;
      for (const it of items) {
        const p = it.product_id ? byId.get(it.product_id) : undefined;
        if (!p) { gone.push(it.product_name); continue; }
        // postgres numerics can arrive as strings — coerce before the quantity
        // resolver, which expects a real number.
        const units = ffQty
          ? resolveQuantity({ ...p, price: Number(p.price) || 0 }, it.quantity).units
          : Math.max(1, it.quantity);
        next[p.id] = {
          qty: units,
          name: p.name,
          price: resolvePrice(p.id, Number(p.price) || 0, priceMap, d),
          sku: p.sku ?? null,
          picture_link: p.picture_link ?? "",
          display_qty: p.display_qty ?? null,
          display_name: p.display_name ?? null,
        };
        added++;
      }
      if (added === 0) {
        setReorderMsg("כל המוצרים בהזמנה הזאת כבר לא זמינים.");
        return;
      }
      try { localStorage.setItem(CART_KEY, JSON.stringify(next)); } catch { /* private mode: fall through */ }
      if (gone.length > 0) {
        // Something is missing, so DO NOT navigate. An auto-redirect gave the
        // customer about a second and a half to read a Hebrew sentence naming
        // products — not enough, and the catalogue cannot explain an absence
        // once they are there. Show it and let them move on when they have read
        // it.
        setReorderMsg(`נוספו ${added} מוצרים לעגלה. לא זמינים יותר: ${gone.join(", ")}`);
        setReorderCta(true);
        return;
      }
      router.push("/catalog");
    } catch {
      setReorderMsg("ההזמנה החוזרת נכשלה. נסו שוב בעוד רגע.");
    } finally {
      setReorderingId(null);
    }
  };

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={s.main}>
        <header className={s.head}>
          <h1 className={s.title}>
            ההזמנות שלי
          </h1>
          <p className={s.sub}>
            {profile?.business_name ? `${profile.business_name} · ` : ""}היסטוריית ההזמנות שלכם.
          </p>
        </header>

        {busy ? (
          <div className={s.loading}>
            <p className={s.loadingText}>טוען…</p>
            <div className={s.skeleton} aria-hidden="true" />
            <div className={s.skeleton} aria-hidden="true" />
          </div>
        ) : err ? (
          <div className={s.empty}>
            <p className={s.errorText}>טעינת ההזמנות נכשלה. בדקו את החיבור ונסו שוב.</p>
            <button onClick={load} className={s.primary}>
              נסו שוב
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className={s.empty}>
            <span className={s.emptyIcon} aria-hidden="true">🧸</span>
            <p className={s.emptyText}>עוד לא ביצעתם הזמנות.</p>
            <Link href="/catalog" className={s.primary}>
              לקטלוג
            </Link>
          </div>
        ) : (
          <div className={s.list}>
            {ffReorder && reorderMsg && (
              <div role="status" className={s.notice}>
                {reorderMsg}
                {reorderCta && (
                  <div className={s.noticeCta}>
                    <Link href="/catalog" className={s.primary}>
                      מעבר לעגלה
                    </Link>
                  </div>
                )}
              </div>
            )}
            {orders.map((o) => (
              <div key={o.id} className={s.card}>
                <div className={s.cardHead}>
                  <div className={s.meta}>
                    <span dir="ltr" className={s.orderNo}>#{o.id.slice(0, 8)}</span> · {new Date(o.created_at).toLocaleDateString("he-IL")}
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className={s.items}>
                  {o.order_items?.map((it) => (
                    <div key={it.id} className={s.item}>
                      <span className={s.itemName}>{it.product_name} × {it.quantity}</span>
                      <span className={s.price}>{ils(it.unit_price * it.quantity)}</span>
                    </div>
                  ))}
                </div>
                {o.note && <p className={s.note}>הערה: {o.note}</p>}
                <div className={s.total}>
                  <span>סה״כ</span>
                  <span className={s.totalAmount}>{ils(o.total)}</span>
                </div>
                {ffReorder && (
                  <div className={s.reorderRow}>
                    <button
                      onClick={() => reorder(o)}
                      disabled={reorderingId === o.id}
                      className={s.secondary}
                    >
                      {reorderingId === o.id ? "מוסיף לעגלה…" : "🔁 הזמן שוב"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

