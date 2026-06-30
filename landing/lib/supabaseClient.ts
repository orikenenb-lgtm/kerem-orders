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
  role: "customer" | "manager";
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  emoji: string;
  category: string;
  sku: string;
  in_stock: boolean;
  sort_order: number;
};
