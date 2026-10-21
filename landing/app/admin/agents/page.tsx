"use client";

// Manager screen: the agents, and "יצירת סוכן".
//
// An agent used to exist only by promoting an account that had signed up as a
// customer. The owner asked for a direct way: fill in the agent's details and
// the account exists, ready to log in. Creating the login needs the service
// role, so it goes through the create-agent edge function (manager-only,
// checked server-side); the Rivhit agent number then goes through the
// set_agent_rivhit_number RPC, which also assigns every linked customer whose
// Rivhit card carries that number.
//
// Who sees what is enforced in the database (supabase/2026-10-agent-customers.sql);
// this page only creates and lists.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { tokens } from "../../../lib/ui";
import { featureFlags } from "../../../lib/featureFlags";

const ffAgentCustomers = featureFlags.ff_agent_customers;

type Agent = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  max_discount_percent: number | string | null;
  rivhit_agent_id: number | null;
};

async function fetchAgents() {
  const [a, c, k] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email,phone,role,max_discount_percent,rivhit_agent_id").eq("role", "agent").order("full_name"),
    supabase.from("profiles").select("agent_user_id").eq("role", "customer").not("agent_user_id", "is", null),
    supabase.from("customers").select("agent_id").eq("is_active", true).not("agent_id", "is", null),
  ]);
  if (a.error) return null;
  // Site customers per agent account, and Rivhit cards per agent number.
  const counts = new Map<string, number>();
  for (const r of (c.data ?? []) as { agent_user_id: string }[]) counts.set(r.agent_user_id, (counts.get(r.agent_user_id) ?? 0) + 1);
  const cardCounts = new Map<number, number>();
  for (const r of (k.data ?? []) as { agent_id: number }[]) cardCounts.set(r.agent_id, (cardCounts.get(r.agent_id) ?? 0) + 1);
  return { agents: (a.data as Agent[]) ?? [], counts, cardCounts };
}

export default function AgentsAdminPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [cardCounts, setCardCounts] = useState<Map<number, number>>(new Map());
  const [busy, setBusy] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cap, setCap] = useState("15");
  const [num, setNum] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager || !ffAgentCustomers) router.replace("/admin");
  }, [loading, session, isManager, router]);

  // Loaded in a .then() so no state is set synchronously inside the effect;
  // "יצירת סוכן" bumps reloadKey to refresh the list (which stays on screen).
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!isManager) return;
    let live = true;
    void fetchAgents().then((r) => {
      if (!live) return;
      setBusy(false);
      if (!r) { setLoadErr("טעינת הסוכנים נכשלה. נסו שוב."); return; }
      setLoadErr("");
      setAgents(r.agents);
      setCounts(r.counts);
      setCardCounts(r.cardCounts);
    });
    return () => { live = false; };
  }, [isManager, reloadKey]);

  const capN = Number(cap);
  const numN = num.trim() === "" ? null : Number(num);
  const problems: string[] = [];
  if (!fullName.trim()) problems.push("שם");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) problems.push("אימייל תקין");
  if (password.length < 6) problems.push("סיסמה של 6 תווים לפחות");
  if (!Number.isFinite(capN) || capN < 0 || capN > 100) problems.push("תקרת הנחה בין 0 ל-100");
  if (numN !== null && (!Number.isInteger(numN) || numN <= 0)) problems.push("מספר סוכן חיובי");
  const ready = problems.length === 0;

  const create = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setMsg(null);
    // A taken Rivhit number would leave the account created but unmapped —
    // refuse before anything is created.
    if (numN !== null) {
      const t = await supabase.from("profiles").select("full_name,email").eq("rivhit_agent_id", numN).limit(1);
      if (!mountedRef.current) return;
      const holder = (t.data as { full_name: string | null; email: string | null }[] | null)?.[0];
      if (holder) {
        setSaving(false);
        setMsg({ ok: false, text: `מספר סוכן ${numN} כבר משויך ל${holder.full_name || holder.email || "משתמש אחר"}. לא נוצר כלום.` });
        return;
      }
    }
    const { data, error } = await supabase.functions.invoke("create-agent", {
      body: { full_name: fullName.trim(), phone: phone.trim(), email: email.trim(), password, max_discount_percent: capN },
    });
    if (!mountedRef.current) return;
    // supabase-js puts a non-2xx answer in `error`; the Hebrew text is in the body.
    let errText = (data as { error?: string } | null)?.error || "";
    if (error && !errText) {
      try { errText = (await (error as { context?: Response }).context?.json())?.error || ""; } catch { /* */ }
      if (!errText) errText = "יצירת הסוכן נכשלה — לא נוצר כלום.";
    }
    if (errText) { setSaving(false); setMsg({ ok: false, text: errText }); return; }
    const id = (data as { ok?: boolean; id?: string } | null)?.ok ? (data as { id?: string }).id : undefined;
    // Never claim success the server did not confirm.
    if (!id) {
      setSaving(false);
      setMsg({ ok: false, text: "השרת לא אישר את יצירת הסוכן. בדקו ברשימה למטה לפני שמנסים שוב." });
      setReloadKey((n) => n + 1);
      return;
    }
    let extra = "";
    if (numN !== null) {
      const r = await supabase.rpc("set_agent_rivhit_number", { p_agent: id, p_number: numN });
      if (r.error) extra = ` אבל מספר הסוכן לא נשמר: ${r.error.message}. אפשר לקבוע אותו בכרטיס שלו ב״לקוחות״.`;
      else {
        const moved = Number(r.data) || 0;
        extra = ` מספר סוכן ${numN} ברווחית${moved > 0 ? ` — ${moved.toLocaleString("he-IL")} לקוחות שויכו אליו` : ""}.`;
      }
    }
    if (!mountedRef.current) return;
    setSaving(false);
    setMsg({ ok: !extra.includes("לא נשמר"), text: `הסוכן ${fullName.trim()} נוצר. הוא יכול להתחבר עכשיו עם ${email.trim()} והסיסמה שקבעתם.${extra}` });
    setFullName(""); setPhone(""); setEmail(""); setPassword(""); setCap("15"); setNum("");
    setReloadKey((n) => n + 1);
  };

  if (loading || !isManager || !ffAgentCustomers) return null;

  const field: React.CSSProperties = { width: "100%", minHeight: 44, fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.55rem 0.8rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text };
  const label: React.CSSProperties = { display: "grid", gap: "0.3rem", fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.body };

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>
          <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> · סוכנים
        </div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>סוכנים</h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", maxWidth: 680 }}>
          סוכן רואה באתר רק את הלקוחות שמשויכים אליו ואת ההזמנות שלהם, ונותן הנחה רק להם — עד התקרה שאתם קובעים. הלקוחות לא רואים מי הסוכן שלהם.
        </p>

        <section aria-label="יצירת סוכן" style={{ marginTop: "1.2rem", border: `1px solid ${tokens.border}`, borderRadius: 16, background: tokens.surface, padding: "1rem 1.1rem" }}>
          <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.15rem", color: tokens.text, margin: 0 }}>יצירת סוכן</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem", marginTop: "0.8rem" }}>
            <label style={label}>שם מלא
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" style={field} />
            </label>
            <label style={label}>טלפון
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" autoComplete="off" style={field} />
            </label>
            <label style={label}>אימייל (שם המשתמש שלו להתחברות)
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" autoComplete="off" style={field} />
            </label>
            <label style={label}>סיסמה ראשונית (לפחות 6 תווים)
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" dir="ltr" autoComplete="new-password" style={field} />
            </label>
            <label style={label}>תקרת הנחה (%)
              <input value={cap} onChange={(e) => setCap(e.target.value)} type="number" inputMode="decimal" min={0} max={100} style={field} />
            </label>
            <label style={label}>מספר סוכן ברווחית (לא חובה)
              <input value={num} onChange={(e) => setNum(e.target.value)} type="number" inputMode="numeric" min={1} placeholder="למשל 548" style={field} />
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
            <button onClick={() => void create()} disabled={!ready || saving}
              style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", minHeight: 48, padding: "0.6rem 1.4rem", borderRadius: 999, border: "none", cursor: !ready || saving ? "not-allowed" : "pointer", background: !ready || saving ? tokens.border : tokens.accent, color: !ready || saving ? tokens.dim : "#fff" }}>
              {saving ? "יוצר…" : "יצירת סוכן"}
            </button>
            {!ready && (
              <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>חסר: {problems.join(" · ")}</span>
            )}
          </div>
          <p style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim, margin: "0.6rem 0 0" }}>
            החשבון נפתח מאושר — הסוכן מתחבר מיד עם האימייל והסיסמה. מספר הסוכן ברווחית משייך אליו אוטומטית כל לקוח באתר שבכרטיס שלו ברווחית רשום המספר הזה.
          </p>
          {msg && (
            <p role={msg.ok ? "status" : "alert"} style={{ fontFamily: tokens.assistant, fontSize: "0.92rem", color: msg.ok ? "#1A7A4D" : "#C0143C", margin: "0.7rem 0 0" }}>{msg.text}</p>
          )}
        </section>

        <section aria-label="רשימת הסוכנים" style={{ marginTop: "1.6rem" }}>
          <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.15rem", color: tokens.text, margin: "0 0 0.6rem" }}>
            הסוכנים {busy ? "" : `(${agents.length.toLocaleString("he-IL")})`}
          </h2>
          {loadErr && <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C" }}>{loadErr}</p>}
          {!busy && !loadErr && agents.length === 0 && (
            <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>עוד אין סוכנים. יוצרים אחד למעלה.</p>
          )}
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {agents.map((a) => (
              <div key={a.id} style={{ border: `1px solid ${tokens.border}`, borderRadius: 14, background: "#fff", padding: "0.8rem 1rem", display: "flex", gap: "0.8rem", flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: tokens.text }}>{a.full_name || a.email || "סוכן"}</div>
                  <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>
                    <span dir="ltr">{a.email || "—"}</span> · <span dir="ltr">{a.phone || "בלי טלפון"}</span>
                  </div>
                </div>
                <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, whiteSpace: "nowrap" }}>
                  {a.rivhit_agent_id ? `סוכן ${a.rivhit_agent_id} ברווחית` : "בלי מספר סוכן"}
                  {a.rivhit_agent_id ? ` · ${(cardCounts.get(a.rivhit_agent_id) ?? 0).toLocaleString("he-IL")} כרטיסים ברווחית` : ""}
                </span>
                <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, whiteSpace: "nowrap" }}>
                  {(counts.get(a.id) ?? 0).toLocaleString("he-IL")} לקוחות באתר · עד {Number(a.max_discount_percent) || 0}% הנחה
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim, marginTop: "0.6rem" }}>
            לשינוי תקרה, מספר סוכן או ביטול הרשאה — פותחים את הכרטיס של הסוכן ב<Link href="/admin/customers" style={{ color: tokens.accent }}>לקוחות</Link>.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
