import { createClient } from "@supabase/supabase-js";

// The anon/publishable key is designed to be shipped to the browser; all access
// is enforced server-side by Postgres Row-Level-Security. Safe to commit.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://mcdchalyzeqjkkgfeznd.supabase.co";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_ie1SyncNyRabOTCWTxt8pw_AsESY6F9";

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  business_name: string;
  phone: string;
  role: "customer" | "manager" | "agent";
  // Optional: the column may not exist in the DB yet; missing/null means 0.
  discount_percent?: number | null;
  /** An AGENT's own ceiling — the largest discount they may grant. Set by the
   *  owner, pinned by the protect_privileged_profile_cols trigger so an agent
   *  cannot raise it themselves. Meaningless for customers and managers. */
  max_discount_percent?: number | null;
};
