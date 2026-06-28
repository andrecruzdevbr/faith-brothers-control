import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables } from "@/integrations/supabase/types";
import type { AppRole } from "@/lib/constants";
import { getLoginCredentials } from "@/lib/whatsapp-auth";

type Profile = Tables<"profiles">;

type AuthUser = {
  id: string;
  email: string | null;
  nome: string;
  roles: AppRole[];
  academyId: string | null;
  whatsapp: string | null;
  avatarUrl: string | null;
};

interface AuthContextType {
  user: AuthUser | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isProfessor: boolean;
  isStaff: boolean;
  isAluno: boolean;
  signOut: () => Promise<void>;
  signInWithWhatsapp: (whatsapp: string, password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

type HydratedAuthState = {
  profile: Profile | null;
  roles: AppRole[];
  user: AuthUser | null;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  roles: [],
  loading: true,
  isAuthenticated: false,
  isAdmin: false,
  isProfessor: false,
  isStaff: false,
  isAluno: false,
  signOut: async () => {},
  signInWithWhatsapp: async () => {},
  refreshUser: async () => {},
});

function getPendingSignupMetadata(user: User | null) {
  const metadata = user?.user_metadata ?? {};
  const academyId = typeof metadata.academy_id === "string" ? metadata.academy_id : null;
  const fullName = typeof metadata.full_name === "string" ? metadata.full_name : null;
  const whatsapp = typeof metadata.whatsapp === "string" ? metadata.whatsapp : null;
  if (!academyId || !fullName) return null;
  return { academyId, fullName, whatsapp };
}

async function fetchAuthState(session: Session): Promise<HydratedAuthState> {
  const userId = session.user.id;
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);

  const roles = (roleRows?.map((r) => r.role) ?? []) as AppRole[];

  return {
    profile: profile ?? null,
    roles,
    user: profile && roles.length > 0
      ? {
          id: userId,
          email: session.user.email ?? null,
          nome: profile.full_name,
          roles,
          academyId: profile.academy_id,
          whatsapp: profile.whatsapp,
          avatarUrl: profile.avatar_url,
        }
      : null,
  };
}

async function hydrateAuthState(session: Session | null): Promise<HydratedAuthState> {
  if (!session?.user) return { profile: null, roles: [], user: null };

  let state = await fetchAuthState(session);

  if (!state.profile || state.roles.length === 0) {
    const pendingSignup = getPendingSignupMetadata(session.user);
    if (pendingSignup) {
      const { error } = await supabase.rpc("complete_student_signup", {
        _academy_id: pendingSignup.academyId,
        _full_name: pendingSignup.fullName,
        _whatsapp: pendingSignup.whatsapp,
      });
      if (!error) state = await fetchAuthState(session);
    }
  }

  return state;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    if (!nextSession?.user) {
      setProfile(null);
      setRoles([]);
      setUser(null);
      setLoading(false);
      return;
    }
    const loaded = await hydrateAuthState(nextSession);
    setProfile(loaded.profile);
    setRoles(loaded.roles);
    setUser(loaded.user);
    setLoading(false);
  }, []);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    await applySession(currentSession);
  }, [applySession]);

  const signInWithWhatsapp = useCallback(async (whatsapp: string, password: string) => {
    const { email, password: trimmedPassword } = getLoginCredentials(whatsapp, password);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: trimmedPassword,
    });

    if (error) throw error;
    if (!data.session) {
      throw new Error("Não foi possível iniciar a sessão.");
    }

    await applySession(data.session);
  }, [applySession]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });
    void refreshUser();
    return () => subscription.unsubscribe();
  }, [applySession, refreshUser]);

  const value = useMemo<AuthContextType>(() => {
    const isAdmin = roles.includes("admin");
    const isProfessor = roles.includes("professor");
    const isStaff = isAdmin || isProfessor;
    const isAluno = roles.includes("aluno") && !isStaff;

    return {
      user,
      session,
      profile,
      roles,
      loading,
      isAuthenticated: !!session?.user && roles.length > 0,
      isAdmin,
      isProfessor,
      isStaff,
      isAluno,
      signOut: async () => { await supabase.auth.signOut(); },
      signInWithWhatsapp,
      refreshUser,
    };
  }, [user, session, profile, roles, loading, refreshUser, signInWithWhatsapp]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
