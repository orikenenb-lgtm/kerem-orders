"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "./supabaseClient";

type AuthValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isManager: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({
  session: null,
  profile: null,
  loading: true,
  isManager: false,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // `sessionResolved` flips true only once the INITIAL session has actually been
  // read. `loading` must stay true until then, otherwise route guards see
  // (!loading && !session) and bounce a logged-in user to /login on refresh.
  const [sessionResolved, setSessionResolved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionResolved(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionResolved(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();
    setProfile((data as Profile) ?? null);
  };

  // Wait for the initial session to resolve before touching `loading`, and keep
  // it true until the profile (and thus the role) is settled too.
  useEffect(() => {
    if (!sessionResolved) return;
    let active = true;
    (async () => {
      setLoading(true);
      await loadProfile(session?.user?.id);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [sessionResolved, session?.user?.id]);

  const value: AuthValue = {
    session,
    profile,
    loading,
    isManager: profile?.role === "manager",
    refreshProfile: () => loadProfile(session?.user?.id),
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
