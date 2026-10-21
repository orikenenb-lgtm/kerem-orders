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
import { featureFlags } from "../../../lib/featureFlags";

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
  max_discount_percent?: number | string | null;
  city: string | null;
  street: string | null;
  house_number: string | null;
  zip_code: string | null;
  delivery_notes: string | null;
  rivhit_customer_id: number | null;
  // ff_agent_customers — present only when the flag is on (see COLS).
  rivhit_agent_id?: number | null;
  agent_user_id?: string | null;
  agent_source?: "rivhit" | "pulled" | "manager" | null;
};

type OrderStat = { orders: number; total: number; last: string | null };

type OrderLine = {
  id: string;
  product_name: string | null;
  product_sku: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
};

type CustomerOrder = {
  id: string;
  created_at: string;
  status: string | null;
  total: number | string | null;
  note: string | null;
  rivhit_doc_id: number | null;
  order_items: OrderLine[] | null;
};

const ffAdminOrders = featureFlags.ff_admin_customer_orders;
const ffAgentDiscounts = featureFlags.ff_agent_discounts;
const ffAgentCustomers = featureFlags.ff_agent_customers;

const SOURCE_HE: Record<string, string> = {
  rivhit: "לפי כרטיס הלקוח ברווחית",
  pulled: "הסוכן משך אליו",
  manager: "נקבע ידנית על ידי המנהל",
};

/** One page of a customer's history. 9 orders exist in the whole system today,
 *  but this screen must not become the reason the manager waits when that is
 *  900 — so it is capped and says so rather than silently truncating. */
const ORDER_PAGE = 50;

const STATUS_HE: Record<string, string> = {
  new: "התקבלה",
  processing: "בטיפול",
  done: "הושלמה",
  cancelled: "בוטלה",
};

function statusLabel(s: string | null): string {
  if (!s) return "—";
  return STATUS_HE[s] ?? s;
}

function dateTimeHe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("he-IL")} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
}

/** What this customer buys most, by units, across the orders shown. The owner's
 *  question is "what do they order?" — nine separate order cards answer it only
 *  after he reads all nine and adds up in his head. */
function topProducts(orders: CustomerOrder[], take = 5) {
  const m = new Map<string, { name: string; qty: number; spend: number }>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const it of o.order_items ?? []) {
      const name = (it.product_name || "").trim() || "מוצר ללא שם";
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unit_price) || 0;
      const prev = m.get(name) ?? { name, qty: 0, spend: 0 };
      m.set(name, { name, qty: prev.qty + qty, spend: prev.spend + qty * price });
    }
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, take);
}

const COLS =
  "id,email,full_name,business_name,phone,role,created_at,vat_number,discount_percent,max_discount_percent,city,street,house_number,zip_code,delivery_notes,rivhit_customer_id" +
  // The agent columns exist only once the migration is applied; with the flag
  // off the select is byte-for-byte what it was.
  (ffAgentCustomers ? ",rivhit_agent_id,agent_user_id,agent_source" : "");

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
  const { session, profile, isManager, isAgent, loading } = useAuth();
  // An agent may open this screen, but sees a strictly smaller version of it:
  // no order history, no contact panel, just the customers and the one dial
  // they are allowed to turn. RLS backs this up — profiles_select only exposes
  // customer rows to an agent, so a hand-written query gets the same answer.
  // With ff_agent_customers an agent sees his OWN customers in full — contact
  // details and orders. RLS (profiles_select / orders_select) returns only
  // customers assigned to him, so this widens nothing beyond his own book.
  const canSeeOrders = isManager || (ffAgentCustomers && isAgent);
  const myCap = Number(profile?.max_discount_percent ?? 0) || 0;

  const [people, setPeople] = useState<Person[]>([]);
  const [stats, setStats] = useState<Map<string, OrderStat>>(new Map());
  // Whether the order history came back at all. Without this the screen has no
  // way to tell "this customer has never ordered" from "the orders query
  // failed", and it showed the first for both — which is a lie about the
  // business, on the screen the owner would use to decide who to call.
  const [statsFailed, setStatsFailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Per-customer order history, fetched only when that customer is opened.
  // Loading every order with its lines up front would make this list pay for
  // data the manager may never look at; today that is 36 rows, but the screen
  // should not need rewriting the first busy month.
  const [ordersByUser, setOrdersByUser] = useState<Map<string, CustomerOrder[]>>(new Map());
  const [ordersBusyFor, setOrdersBusyFor] = useState<string | null>(null);
  const [ordersErrFor, setOrdersErrFor] = useState<Map<string, string>>(new Map());
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<Map<string, string>>(new Map());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // The ONLY write this screen performs. It goes through the RPC, never a
  // direct UPDATE, because the RPC is where the ceiling and the audit row live
  // — a direct write would be silently reverted by the profiles trigger anyway.
  const saveDiscount = useCallback(async (customerId: string, percent: number) => {
    setSavingFor(customerId);
    setSaveMsg((m) => { const n2 = new Map(m); n2.delete(customerId); return n2; });
    const { error } = await supabase.rpc("set_customer_discount", { p_customer: customerId, p_percent: percent });
    if (!mountedRef.current) return;
    setSavingFor(null);
    if (error) {
      // The database speaks Hebrew here on purpose: "ההנחה המקסימלית שלך היא
      // 15 אחוז" is the actual server refusal, not a guess made in the browser.
      setSaveMsg((m) => new Map(m).set(customerId, error.message || "השמירה נכשלה."));
      return;
    }
    setPeople((ps) => ps.map((x) => (x.id === customerId ? { ...x, discount_percent: percent } : x)));
    setSaveMsg((m) => new Map(m).set(customerId, `נשמר: ${percent}% הנחה`));
  }, []);

  // Manager-only: promote/demote an agent and set their ceiling.
  const saveAgent = useCallback(async (userId: string, role: string, cap: number) => {
    setSavingFor(userId);
    setSaveMsg((m) => { const n2 = new Map(m); n2.delete(userId); return n2; });
    const { error } = await supabase.from("profiles").update({ role, max_discount_percent: cap }).eq("id", userId);
    if (!mountedRef.current) return;
    setSavingFor(null);
    if (error) { setSaveMsg((m) => new Map(m).set(userId, "השמירה נכשלה.")); return; }
    setPeople((ps) => ps.map((x) => (x.id === userId ? { ...x, role, max_discount_percent: cap } : x)));
    setSaveMsg((m) => new Map(m).set(userId, role === "agent" ? `נשמר: סוכן עד ${cap}%` : "נשמר: לקוח רגיל"));
  }, []);

  // ---- ff_agent_customers ------------------------------------------------
  // Which agent number each Rivhit card carries (manager only — RLS gives the
  // manager every card; an agent never needs this map).
  const [cardAgent, setCardAgent] = useState<Map<number, number | null>>(new Map());
  // "all" | "none" | <agent profile id>
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [claimInput, setClaimInput] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState<{ ok: boolean; text: string } | null>(null);


  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager && !(ffAgentDiscounts && isAgent)) router.replace("/catalog");
  }, [loading, session, isManager, isAgent, router]);

  // Debounced so typing does not re-filter on every keystroke once the list is
  // long — same 350ms the catalogue uses.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  const load = useCallback(async () => {
    if (!isManager && !isAgent) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("profiles")
      .select(COLS)
      .order("business_name", { nullsFirst: false });
    if (!mountedRef.current) return;
    if (error) { setErr("טעינת הלקוחות נכשלה. בדקו את החיבור ונסו שוב."); setBusy(false); return; }
    setErr("");
    setPeople((data as unknown as Person[]) ?? []);

    if (ffAgentCustomers && isManager) {
      const { data: cards } = await supabase.from("customers").select("rivhit_id,agent_id");
      if (!mountedRef.current) return;
      setCardAgent(new Map(((cards ?? []) as { rivhit_id: number; agent_id: number | null }[]).map((c) => [c.rivhit_id, c.agent_id])));
    }

    // Order history per person. The manager can already read every order on
    // /admin, so this adds no access — it just saves him from cross-checking
    // two screens to answer "did this customer ever order?".
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("user_id,total,created_at,status");
    if (!mountedRef.current) return;
    if (ordersErr) {
      // The customer list itself loaded, so keep showing it — just stop
      // claiming anything about who has ordered.
      setStatsFailed(true);
      setStats(new Map());
      setBusy(false);
      return;
    }
    setStatsFailed(false);
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
  }, [isManager, isAgent]);

  useEffect(() => { load(); }, [load]);

  // Manager: fix a customer's agent by hand (null = none). Rivhit never
  // overrides a manual choice until it is released below.
  const setCustomerAgent = useCallback(async (customerId: string, agentId: string | null) => {
    setSavingFor(customerId);
    setSaveMsg((m) => { const n2 = new Map(m); n2.delete(customerId); return n2; });
    const { error } = await supabase.rpc("set_customer_agent", { p_customer: customerId, p_agent: agentId });
    if (!mountedRef.current) return;
    setSavingFor(null);
    if (error) { setSaveMsg((m) => new Map(m).set(customerId, error.message || "השמירה נכשלה.")); return; }
    setPeople((ps) => ps.map((x) => (x.id === customerId ? { ...x, agent_user_id: agentId, agent_source: "manager" } : x)));
    setSaveMsg((m) => new Map(m).set(customerId, agentId ? "נשמר: הסוכן נקבע ידנית" : "נשמר: ללא סוכן"));
  }, []);

  // Manager: drop the manual choice and go back to the Rivhit card's agent.
  const releaseCustomerAgent = useCallback(async (customerId: string) => {
    setSavingFor(customerId);
    const { data, error } = await supabase.rpc("release_customer_agent", { p_customer: customerId });
    if (!mountedRef.current) return;
    setSavingFor(null);
    if (error) { setSaveMsg((m) => new Map(m).set(customerId, error.message || "השמירה נכשלה.")); return; }
    const agentId = (data as string | null) ?? null;
    setPeople((ps) => ps.map((x) => (x.id === customerId ? { ...x, agent_user_id: agentId, agent_source: agentId ? "rivhit" : null } : x)));
    setSaveMsg((m) => new Map(m).set(customerId, "נשמר: השיוך חזר להיות לפי רווחית"));
  }, []);

  // Manager: "Rivhit agent N = this account". Returns how many customers moved.
  const saveAgentNumber = useCallback(async (userId: string, n: number | null) => {
    setSavingFor(userId);
    setSaveMsg((m) => { const n2 = new Map(m); n2.delete(userId); return n2; });
    const { data, error } = await supabase.rpc("set_agent_rivhit_number", { p_agent: userId, p_number: n });
    if (!mountedRef.current) return;
    setSavingFor(null);
    if (error) { setSaveMsg((m) => new Map(m).set(userId, error.message || "השמירה נכשלה.")); return; }
    const moved = Number(data) || 0;
    setSaveMsg((m) => new Map(m).set(userId, n
      ? `נשמר: מספר סוכן ${n} ברווחית${moved > 0 ? ` · ${moved.toLocaleString("he-IL")} לקוחות שויכו אליו` : ""}`
      : "נשמר: בלי מספר סוכן"));
    // Assignments may have changed for many rows — reload the list.
    void load();
  }, [load]);

  // Agent: pull a customer with no agent, by exact phone or ח.פ. The server
  // refuses anyone else's customer and anything ambiguous, in Hebrew.
  const claim = useCallback(async () => {
    const q = claimInput.trim();
    if (!q || claimBusy) return;
    setClaimBusy(true);
    setClaimMsg(null);
    const { data, error } = await supabase.rpc("claim_customer", { p_query: q });
    if (!mountedRef.current) return;
    setClaimBusy(false);
    if (error) { setClaimMsg({ ok: false, text: error.message || "המשיכה נכשלה." }); return; }
    setClaimMsg({ ok: true, text: `"${String(data || "הלקוח")}" משויך אליכם עכשיו.` });
    setClaimInput("");
    void load();
  }, [claimInput, claimBusy, load]);

  // One round trip per customer: the orders plus their lines, newest first.
  // RLS already lets a manager read every order and every order_item
  // (orders_select / order_items_select both fall back to is_manager()), so
  // this grants no access the account did not already have — it just puts the
  // answer on the screen the question is asked on.
  const loadOrders = useCallback(async (userId: string) => {
    if (!ffAdminOrders || !canSeeOrders) return;
    setOrdersBusyFor(userId);
    const { data, error } = await supabase
      .from("orders")
      .select("id,created_at,status,total,note,rivhit_doc_id,order_items(id,product_name,product_sku,quantity,unit_price)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(ORDER_PAGE);
    if (!mountedRef.current) return;
    setOrdersBusyFor(null);
    if (error) {
      // Never leave a blank panel that reads like "this customer never ordered".
      setOrdersErrFor((m) => new Map(m).set(userId, "טעינת ההזמנות נכשלה. נסו שוב."));
      return;
    }
    setOrdersErrFor((m) => { const n = new Map(m); n.delete(userId); return n; });
    setOrdersByUser((m) => new Map(m).set(userId, (data as CustomerOrder[]) ?? []));
  }, [canSeeOrders]);

  const toggleCustomer = useCallback((id: string) => {
    setOpenId((cur) => {
      const next = cur === id ? null : id;
      if (next && ffAdminOrders && !ordersByUser.has(next)) void loadOrders(next);
      return next;
    });
  }, [ordersByUser, loadOrders]);

  // The people an agent can be assigned to: agents and the manager himself.
  const agents = useMemo(() => people.filter((p) => p.role === "agent" || p.role === "manager"), [people]);
  const agentName = useCallback((id: string | null | undefined) => {
    if (!id) return null;
    const a = people.find((x) => x.id === id);
    return a ? (a.full_name || a.business_name || a.email || "סוכן") : "סוכן";
  }, [people]);

  const shown = useMemo(() => {
    const q = normalizeHe(query);
    // An agent's own profile comes back from RLS (id = auth.uid()) but is not
    // one of his customers — keep it out of his list and his count.
    let list = ffAgentCustomers && !isManager ? people.filter((p) => p.role === "customer") : people;
    if (ffAgentCustomers && isManager && agentFilter !== "all") {
      list = list.filter((p) => p.role === "customer" && (agentFilter === "none" ? !p.agent_user_id : p.agent_user_id === agentFilter));
    }
    if (!q) return list;
    const words = q.split(" ").filter(Boolean);
    // Every word has to appear somewhere, in any order — so "אבי תל אביב"
    // finds the right shop even though the words come from three fields.
    return list.filter((p) => {
      const h = haystack(p);
      return words.every((w) => h.includes(w));
    });
  }, [people, query, agentFilter, isManager]);

  const customerCount = ffAgentCustomers && !isManager
    ? people.filter((p) => p.role === "customer").length
    : people.filter((p) => p.role !== "manager").length;

  if (loading || !(isManager || (ffAgentDiscounts && isAgent))) return null;

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        {/* An agent has no /admin, so do not offer them a crumb that bounces
            them straight back to the catalogue. */}
        {isManager ? (
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>
            <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> · לקוחות
          </div>
        ) : (
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>סוכן · לקוחות</div>
        )}
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
          לקוחות
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", maxWidth: 720 }}>
          {isManager
            ? "כל מי שרשום במערכת. אפשר לחפש לפי שם העסק, שם איש הקשר, אימייל, טלפון, ח״פ או עיר — ולפתוח כרטיס לקוח כדי לראות את כתובת המשלוח, ההנחה הקבועה, וכל ההזמנות שלו: מה בדיוק הזמין בכל הזמנה, באיזו כמות, באיזה מחיר, וכמה הוציא בסך הכול."
            : ffAgentCustomers
              ? `הלקוחות שמשויכים אליכם — לפי כרטיס הלקוח ברווחית, או שמשכתם אליכם. פתחו כרטיס כדי לראות פרטים והזמנות ולקבוע הנחה קבועה — עד ${myCap}% לפי ההרשאה שלכם. כל שינוי נרשם ביומן עם השם שלכם.`
              : `הלקוחות שלכם. פתחו כרטיס כדי לקבוע ללקוח הנחה קבועה — עד ${myCap}% לפי ההרשאה שלכם. כל שינוי נרשם ביומן עם השם שלכם.`}
        </p>

        {ffAgentCustomers && isAgent && !isManager && (
          <section aria-label="משיכת לקוח אליי" style={{ marginTop: "1rem", border: `1px solid ${tokens.border}`, borderRadius: 14, background: tokens.surface, padding: "0.9rem 1rem" }}>
            <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: tokens.text }}>משיכת לקוח אליי</div>
            <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, margin: "0.25rem 0 0.6rem" }}>
              לקוח שנרשם לאתר ועוד אין לו סוכן — מקלידים את הטלפון או הח״פ שלו, והוא עובר אליכם. לקוח של סוכן אחר רק המנהל מעביר.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                inputMode="numeric"
                aria-label="טלפון או ח״פ של הלקוח"
                placeholder="טלפון או ח״פ"
                value={claimInput}
                onChange={(e) => setClaimInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void claim(); }}
                dir="ltr"
                style={{ flex: 1, minWidth: 180, minHeight: 44, fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.5rem 0.8rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }}
              />
              <button onClick={() => void claim()} disabled={claimBusy || !claimInput.trim()} style={{ ...miniBtn, minHeight: 44, fontWeight: 800, background: claimBusy || !claimInput.trim() ? "#fff" : tokens.accent, color: claimBusy || !claimInput.trim() ? tokens.dim : "#fff" }}>
                {claimBusy ? "מושך…" : "משיכה אליי"}
              </button>
            </div>
            {claimMsg && (
              <p role={claimMsg.ok ? "status" : "alert"} style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: claimMsg.ok ? "#1A7A4D" : "#C0143C", margin: "0.5rem 0 0" }}>{claimMsg.text}</p>
            )}
          </section>
        )}

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
          {ffAgentCustomers && isManager && !busy && (
            <div role="group" aria-label="סינון לפי סוכן" style={{ display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "0.2rem", marginTop: "0.4rem" }}>
              {[
                { key: "all", label: "כל הלקוחות", n: people.filter((p) => p.role === "customer").length },
                { key: "none", label: "ללא סוכן", n: people.filter((p) => p.role === "customer" && !p.agent_user_id).length },
                ...agents.map((a) => ({ key: a.id, label: (a.full_name || a.business_name || a.email || "סוכן") + (a.rivhit_agent_id ? ` · ${a.rivhit_agent_id}` : ""), n: people.filter((p) => p.role === "customer" && p.agent_user_id === a.id).length })),
              ].map((c) => (
                <button key={c.key} onClick={() => setAgentFilter(c.key)} aria-pressed={agentFilter === c.key}
                  style={{ ...miniBtn, whiteSpace: "nowrap", minHeight: 36, background: agentFilter === c.key ? tokens.accent : "#fff", color: agentFilter === c.key ? "#fff" : tokens.body, borderColor: agentFilter === c.key ? "transparent" : tokens.border }}>
                  {c.label} ({c.n.toLocaleString("he-IL")})
                </button>
              ))}
            </div>
          )}
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
                  {ffAgentCustomers && isManager && p.role === "customer" && (
                    <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.75rem", color: p.agent_user_id ? tokens.body : tokens.dim, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 999, padding: "0.2rem 0.6rem", whiteSpace: "nowrap" }}>
                      {p.agent_user_id ? `סוכן: ${agentName(p.agent_user_id)}` : "ללא סוכן"}
                    </span>
                  )}
                  {discount > 0 && (
                    <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.75rem", color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 999, padding: "0.2rem 0.6rem" }}>
                      הנחה קבועה {discount}%
                    </span>
                  )}
                  <span style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim, whiteSpace: "nowrap" }}>
                    {statsFailed
                      ? "היסטוריית ההזמנות לא נטענה"
                      : st
                        ? `${st.orders.toLocaleString("he-IL")} הזמנות · ${ils(st.total)}`
                        : "עוד לא הזמין"}
                  </span>
                  <button
                    onClick={() => toggleCustomer(p.id)}
                    aria-expanded={open}
                    style={{ ...miniBtn, minHeight: 44, background: open ? tokens.accent : "#fff", color: open ? "#fff" : tokens.text }}
                  >
                    {open ? "סגירה" : "פרטים"}
                  </button>
                </div>

                {open && canSeeOrders && (
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

                {open && ffAgentCustomers && isManager && (
                  <AgentPanel
                    person={p}
                    agents={agents}
                    cardAgentNumber={p.rivhit_customer_id != null ? (cardAgent.get(p.rivhit_customer_id) ?? null) : null}
                    busy={savingFor === p.id}
                    onSetAgent={(agentId) => setCustomerAgent(p.id, agentId)}
                    onRelease={() => releaseCustomerAgent(p.id)}
                    onSaveNumber={(n) => saveAgentNumber(p.id, n)}
                  />
                )}

                {open && ffAgentDiscounts && (
                  <DiscountEditor
                    person={p}
                    isManager={isManager}
                    myCap={isManager ? 99 : myCap}
                    busy={savingFor === p.id}
                    msg={saveMsg.get(p.id)}
                    onSaveDiscount={(pct) => saveDiscount(p.id, pct)}
                    onSaveAgent={(role, cap) => saveAgent(p.id, role, cap)}
                  />
                )}

                {open && ffAdminOrders && canSeeOrders && (
                  <CustomerOrders
                    busy={ordersBusyFor === p.id}
                    err={ordersErrFor.get(p.id)}
                    orders={ordersByUser.get(p.id)}
                    onRetry={() => loadOrders(p.id)}
                  />
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

/** The one control an agent is allowed to touch, and the manager's controls for
 *  appointing agents. Every write goes through set_customer_discount(), whose
 *  ceiling lives in the database — the numbers below are a courtesy, not the
 *  protection. */
function DiscountEditor({
  person, isManager, myCap, busy, msg, onSaveDiscount, onSaveAgent,
}: {
  person: Person;
  isManager: boolean;
  myCap: number;
  busy: boolean;
  msg: string | undefined;
  onSaveDiscount: (pct: number) => void;
  onSaveAgent: (role: string, cap: number) => void;
}) {
  const current = Number(person.discount_percent) || 0;
  const [pct, setPct] = useState(String(current));
  const [cap, setCap] = useState(String(Number(person.max_discount_percent) || 15));
  const isCustomer = person.role === "customer";
  const asked = Number(pct);
  const overCap = Number.isFinite(asked) && asked > myCap;
  const bad = !Number.isFinite(asked) || asked < 0 || asked >= 100;

  return (
    <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: "0.8rem", paddingTop: "0.8rem", display: "grid", gap: "0.7rem" }}>
      {isCustomer ? (
        <div>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.95rem", color: tokens.text, marginBottom: "0.4rem" }}>
            הנחה קבועה ללקוח
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              type="number" inputMode="decimal" min={0} max={myCap} step="0.5"
              value={pct} onChange={(e) => setPct(e.target.value)}
              aria-label={`אחוז הנחה עבור ${person.business_name || person.full_name || "הלקוח"}`}
              style={{ width: 96, minHeight: 44, fontFamily: tokens.assistant, fontSize: "1rem", textAlign: "center", padding: "0.5rem", borderRadius: 10, border: `1px solid ${overCap || bad ? "#C0143C" : tokens.border}`, background: "#fff", color: tokens.text }}
            />
            <span style={{ fontFamily: tokens.assistant, color: tokens.body }}>%</span>
            <button
              onClick={() => onSaveDiscount(asked)}
              disabled={busy || bad || overCap || asked === current}
              style={{ ...miniBtn, minHeight: 44, fontWeight: 800, background: busy || bad || overCap || asked === current ? "#fff" : tokens.accent, color: busy || bad || overCap || asked === current ? tokens.dim : "#fff", cursor: busy || bad || overCap || asked === current ? "not-allowed" : "pointer" }}
            >
              {busy ? "שומר…" : "שמירת ההנחה"}
            </button>
            <span style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim }}>
              {isManager ? "כמנהל אין לך תקרה" : `המקסימום שלך: ${myCap}%`}
            </span>
          </div>
          {overCap && (
            <p role="alert" style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#C0143C", marginTop: "0.35rem" }}>
              מעל התקרה שלך ({myCap}%). גם אם תנסו לשלוח — השרת יסרב.
            </p>
          )}
          <p style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim, marginTop: "0.35rem" }}>
            כרגע: {current}% · ההנחה חלה על כל הקטלוג ונרשמת ביומן עם השם שלכם.
          </p>
        </div>
      ) : (
        <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>
          {person.role === "manager" ? "מנהל — אין הנחה קבועה." : "סוכן — אין הנחה קבועה."}
        </p>
      )}

      {isManager && person.role !== "manager" && (
        <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 12, padding: "0.7rem 0.9rem" }}>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", color: tokens.text, marginBottom: "0.4rem" }}>
            הרשאת סוכן
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {person.role === "agent" ? (
              <>
                <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body }}>מקסימום הנחה שהוא יכול לתת:</span>
                <input
                  type="number" inputMode="decimal" min={0} max={100} step="1"
                  value={cap} onChange={(e) => setCap(e.target.value)}
                  aria-label="תקרת ההנחה של הסוכן"
                  style={{ width: 90, minHeight: 44, fontFamily: tokens.assistant, fontSize: "1rem", textAlign: "center", padding: "0.5rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }}
                />
                <span style={{ fontFamily: tokens.assistant, color: tokens.body }}>%</span>
                <button onClick={() => onSaveAgent("agent", Number(cap) || 0)} disabled={busy} style={{ ...miniBtn, minHeight: 44, fontWeight: 800 }}>
                  שמירת התקרה
                </button>
                <button onClick={() => onSaveAgent("customer", Number(cap) || 0)} disabled={busy} style={{ ...miniBtn, minHeight: 44, color: "#C0143C", borderColor: "rgba(192,20,60,0.35)" }}>
                  ביטול הרשאת סוכן
                </button>
              </>
            ) : (
              <>
                <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body }}>הפוך לסוכן עם תקרה של</span>
                <input
                  type="number" inputMode="decimal" min={0} max={100} step="1"
                  value={cap} onChange={(e) => setCap(e.target.value)}
                  aria-label="תקרת ההנחה של הסוכן"
                  style={{ width: 90, minHeight: 44, fontFamily: tokens.assistant, fontSize: "1rem", textAlign: "center", padding: "0.5rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }}
                />
                <span style={{ fontFamily: tokens.assistant, color: tokens.body }}>%</span>
                <button onClick={() => onSaveAgent("agent", Number(cap) || 0)} disabled={busy} style={{ ...miniBtn, minHeight: 44, fontWeight: 800, background: tokens.accent, color: "#fff" }}>
                  הפיכה לסוכן
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {msg && (
        <p role="status" style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: msg.startsWith("נשמר") ? "#1A7A4D" : "#C0143C", margin: 0 }}>
          {msg}
        </p>
      )}
    </div>
  );
}

/** A customer's order history: what they bought, how much of it, and for how
 *  much. Manager-only, read-only, behind ff_admin_customer_orders. */
function CustomerOrders({
  busy, err, orders, onRetry,
}: {
  busy: boolean;
  err: string | undefined;
  orders: CustomerOrder[] | undefined;
  onRetry: () => void;
}) {
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  if (busy) {
    return (
      <p style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.dim, borderTop: `1px solid ${tokens.border}`, marginTop: "0.8rem", paddingTop: "0.8rem" }}>
        טוען את ההזמנות…
      </p>
    );
  }
  if (err) {
    return (
      <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: "0.8rem", paddingTop: "0.8rem" }}>
        <p role="alert" style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: "#C0143C", marginBottom: "0.5rem" }}>{err}</p>
        <button onClick={onRetry} style={miniBtn}>נסו שוב</button>
      </div>
    );
  }
  if (!orders) return null;
  if (orders.length === 0) {
    return (
      <p style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.dim, borderTop: `1px solid ${tokens.border}`, marginTop: "0.8rem", paddingTop: "0.8rem" }}>
        הלקוח עוד לא ביצע הזמנה.
      </p>
    );
  }

  const live = orders.filter((o) => o.status !== "cancelled");
  const spend = live.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  const units = live.reduce(
    (sum, o) => sum + (o.order_items ?? []).reduce((n, it) => n + (Number(it.quantity) || 0), 0),
    0
  );
  const top = topProducts(orders);

  return (
    <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: "0.8rem", paddingTop: "0.8rem" }}>
      <h3 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.95rem", color: tokens.text, marginBottom: "0.5rem" }}>
        ההזמנות של הלקוח
      </h3>
      <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, marginBottom: "0.7rem" }}>
        {live.length.toLocaleString("he-IL")} הזמנות · {units.toLocaleString("he-IL")} יחידות · {ils(spend)}
        {orders.length !== live.length ? ` · ${(orders.length - live.length).toLocaleString("he-IL")} בוטלו` : ""}
        {orders.length >= ORDER_PAGE ? ` · מוצגות ${ORDER_PAGE} האחרונות` : ""}
      </p>

      {top.length > 0 && (
        <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 12, padding: "0.7rem 0.9rem", marginBottom: "0.8rem" }}>
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.75rem", color: tokens.dim, marginBottom: "0.35rem" }}>הכי מזמין</div>
          <ol style={{ margin: 0, paddingInlineStart: "1.1rem", display: "grid", gap: "0.2rem" }}>
            {top.map((t) => (
              <li key={t.name} style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.text }}>
                {t.name} — <strong>{t.qty.toLocaleString("he-IL")} יח׳</strong> · {ils(t.spend)}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div style={{ display: "grid", gap: "0.5rem" }}>
        {orders.map((o) => {
          const lines = o.order_items ?? [];
          const isOpen = openOrder === o.id;
          const cancelled = o.status === "cancelled";
          const lineSum = lines.reduce((n, it) => n + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
          const stored = Number(o.total) || 0;
          // The stored total is what the customer was actually charged. If the
          // lines no longer add up to it, say so instead of quietly showing two
          // numbers and letting the owner trust the wrong one.
          const mismatch = lines.length > 0 && Math.abs(lineSum - stored) >= 0.01;
          return (
            <div key={o.id} style={{ border: `1px solid ${isOpen ? tokens.accent : tokens.border}`, borderRadius: 12, padding: "0.6rem 0.8rem", background: cancelled ? "rgba(0,0,0,0.02)" : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                <span style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim, whiteSpace: "nowrap" }}>
                  {dateTimeHe(o.created_at)}
                </span>
                <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.7rem", padding: "0.15rem 0.55rem", borderRadius: 999, color: cancelled ? "#C0143C" : "#1A7A4D", background: cancelled ? "rgba(192,20,60,0.10)" : "rgba(37,199,126,0.12)", whiteSpace: "nowrap" }}>
                  {statusLabel(o.status)}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim, whiteSpace: "nowrap" }}>
                  {lines.length.toLocaleString("he-IL")} שורות
                </span>
                <strong style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.95rem", color: tokens.text, whiteSpace: "nowrap" }}>
                  {ils(stored)}
                </strong>
                <button
                  onClick={() => setOpenOrder(isOpen ? null : o.id)}
                  aria-expanded={isOpen}
                  style={{ ...miniBtn, minHeight: 40, fontSize: "0.78rem", background: isOpen ? tokens.accent : "#fff", color: isOpen ? "#fff" : tokens.text }}
                >
                  {isOpen ? "סגירה" : "מה הזמין"}
                </button>
              </div>

              {/* Deliberately NOT a table and NOT a sideways scroller. The first
                  version was a 5-column table with minWidth 420 inside an
                  overflow-x box: on a 390px phone that made the CARD wider than
                  the screen, so product names were clipped on one side and the
                  whole סה״כ column fell off the other — the owner saw "half and
                  half". Stacked blocks cannot be cut at any width. */}
              {isOpen && (
                <div style={{ marginTop: "0.6rem" }}>
                  {lines.length === 0 ? (
                    <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, margin: 0 }}>
                      אין שורות שמורות להזמנה הזו.
                    </p>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.45rem" }}>
                        {lines.map((it) => {
                          const q = Number(it.quantity) || 0;
                          const u = Number(it.unit_price) || 0;
                          return (
                            <li key={it.id} style={{ border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.5rem 0.6rem", background: tokens.surface }}>
                              <div style={{ fontFamily: tokens.assistant, fontWeight: 700, fontSize: "0.88rem", color: tokens.text, lineHeight: 1.3, overflowWrap: "anywhere" }}>
                                {it.product_name || "—"}
                              </div>
                              {it.product_sku && (
                                <div style={{ fontFamily: tokens.assistant, fontSize: "0.75rem", color: tokens.dim, marginTop: "0.15rem" }}>
                                  מק״ט <span dir="ltr">{it.product_sku}</span>
                                </div>
                              )}
                              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.3rem" }}>
                                <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body }}>
                                  {q.toLocaleString("he-IL")} יח׳ × {ils(u)}
                                </span>
                                <strong style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", color: tokens.text }}>
                                  {ils(q * u)}
                                </strong>
                              </div>
                            </li>
                          );
                        })}
                        <li style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap", borderTop: `2px solid ${tokens.border}`, paddingTop: "0.5rem", marginTop: "0.15rem" }}>
                          <span style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", color: tokens.text }}>סה״כ ההזמנה</span>
                          <strong style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: tokens.text }}>{ils(stored)}</strong>
                        </li>
                    </ul>
                  )}
                  {mismatch && (
                    <p style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: "#C0143C", marginTop: "0.5rem" }}>
                      שימו לב: סכום השורות ({ils(lineSum)}) שונה מהסכום השמור בהזמנה ({ils(stored)}).
                    </p>
                  )}
                  {o.note && (
                    <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, marginTop: "0.5rem" }}>
                      הערת הלקוח: {o.note}
                    </p>
                  )}
                  {o.rivhit_doc_id ? (
                    <p style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim, marginTop: "0.35rem" }}>
                      מסמך ברווחית: <span dir="ltr">{o.rivhit_doc_id}</span>
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Manager-only: who this customer belongs to, and — on an agent's or the
 *  manager's own card — which Rivhit agent number is theirs. Every write is an
 *  RPC whose rules live in the database (supabase/2026-10-agent-customers.sql). */
function AgentPanel({
  person, agents, cardAgentNumber, busy, onSetAgent, onRelease, onSaveNumber,
}: {
  person: Person;
  agents: Person[];
  cardAgentNumber: number | null;
  busy: boolean;
  onSetAgent: (agentId: string | null) => void;
  onRelease: () => void;
  onSaveNumber: (n: number | null) => void;
}) {
  const [num, setNum] = useState(person.rivhit_agent_id ? String(person.rivhit_agent_id) : "");
  const box: React.CSSProperties = { borderTop: `1px solid ${tokens.border}`, marginTop: "0.8rem", paddingTop: "0.8rem" };
  const h: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.95rem", color: tokens.text, marginBottom: "0.4rem" };
  const note: React.CSSProperties = { fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim, marginTop: "0.35rem" };

  if (person.role === "agent" || person.role === "manager") {
    const parsed = num.trim() === "" ? null : Number(num);
    const bad = parsed !== null && (!Number.isInteger(parsed) || parsed <= 0);
    const same = (parsed ?? null) === (person.rivhit_agent_id ?? null);
    return (
      <div style={box}>
        <div style={h}>מספר סוכן ברווחית</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <input type="number" inputMode="numeric" min={1} step={1} value={num} onChange={(e) => setNum(e.target.value)}
            aria-label="מספר הסוכן ברווחית" placeholder="למשל 548"
            style={{ width: 110, minHeight: 44, fontFamily: tokens.assistant, fontSize: "1rem", textAlign: "center", padding: "0.5rem", borderRadius: 10, border: `1px solid ${bad ? "#C0143C" : tokens.border}`, background: "#fff", color: tokens.text }} />
          <button onClick={() => onSaveNumber(parsed)} disabled={busy || bad || same}
            style={{ ...miniBtn, minHeight: 44, fontWeight: 800, background: busy || bad || same ? "#fff" : tokens.accent, color: busy || bad || same ? tokens.dim : "#fff" }}>
            {busy ? "שומר…" : "שמירה"}
          </button>
        </div>
        <p style={note}>
          כל לקוח שבכרטיס שלו ברווחית רשום המספר הזה ישויך {person.role === "manager" ? "אליך" : "לסוכן הזה"} אוטומטית — עכשיו, וגם בכל לקוח שיקושר לרווחית בהמשך. לקוח שקבעת לו סוכן ידנית לא יזוז.
        </p>
      </div>
    );
  }

  const source = person.agent_source ? SOURCE_HE[person.agent_source] : null;
  return (
    <div style={box}>
      <div style={h}>סוכן אחראי</div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <select value={person.agent_user_id ?? ""} disabled={busy} onChange={(e) => onSetAgent(e.target.value || null)}
          aria-label="הסוכן האחראי על הלקוח"
          style={{ minHeight: 44, minWidth: 180, fontFamily: tokens.assistant, fontSize: "0.95rem", padding: "0.4rem 0.6rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }}>
          <option value="">ללא סוכן</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {(a.full_name || a.business_name || a.email || "סוכן") + (a.role === "manager" ? " (מנהל)" : "") + (a.rivhit_agent_id ? ` · ${a.rivhit_agent_id}` : "")}
            </option>
          ))}
        </select>
        {person.agent_source === "manager" && (
          <button onClick={onRelease} disabled={busy} style={{ ...miniBtn, minHeight: 44 }}>חזרה לשיוך לפי רווחית</button>
        )}
      </div>
      <p style={note}>
        {source ? `${source}. ` : ""}
        {person.rivhit_customer_id == null
          ? "הלקוח לא מקושר לכרטיס ברווחית."
          : cardAgentNumber
            ? `בכרטיס ברווחית: סוכן ${cardAgentNumber}.`
            : "בכרטיס ברווחית לא רשום סוכן."}
        {" "}בחירה כאן נשמרת כשיוך ידני, ורווחית לא תשנה אותה.
      </p>
    </div>
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
