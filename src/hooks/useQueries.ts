import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PAGE_SIZE } from "@/lib/constants";

export function useAcademyId() {
  return useQuery({
    queryKey: ["academy-id"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("academy_id").eq("user_id", user.id).single();
      return data?.academy_id ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useStudents(page = 1, search = "") {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["students", academyId, page, search],
    enabled: !!academyId,
    queryFn: async () => {
      let query = supabase
        .from("students")
        .select("*, plans(name, monthly_price, package_total_amount, duration_months, billing_mode, allows_installments, max_installments, training_days_per_week)", { count: "exact" })
        .eq("academy_id", academyId!)
        .order("full_name")
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (search.trim()) query = query.ilike("full_name", `%${search.trim()}%`);

      const { data, count, error } = await query;
      if (error) throw error;
      return { students: data ?? [], total: count ?? 0 };
    },
  });
}

export function usePlans() {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["plans", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").eq("academy_id", academyId!).eq("active", true).order("monthly_price");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useBillings(page = 1, status?: string) {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["billings", academyId, page, status],
    enabled: !!academyId,
    queryFn: async () => {
      let query = supabase
        .from("billings")
        .select("*, students(full_name, whatsapp), plans(name)", { count: "exact" })
        .eq("academy_id", academyId!)
        .order("due_date", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (status) query = query.eq("status", status as "pago");

      const { data, count, error } = await query;
      if (error) throw error;
      return { billings: data ?? [], total: count ?? 0 };
    },
  });
}

export function useMyBillings() {
  return useQuery({
    queryKey: ["my-billings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: student } = await supabase.from("students").select("id, plan_id, plans(name, monthly_price)").eq("profile_user_id", user.id).maybeSingle();
      if (!student) return [];

      const { data, error } = await supabase
        .from("billings")
        .select("*")
        .eq("student_id", student.id)
        .order("reference_month", { ascending: false })
        .limit(24);

      if (error) throw error;
      return { student, billings: data ?? [] };
    },
  });
}

export function useClasses() {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["classes", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("classes").select("*").eq("academy_id", academyId!).eq("active", true).order("name");
      if (error) {
        const { data: fallback } = await supabase.from("plans").select("id, name, training_days_per_week, academy_id").eq("academy_id", academyId!).eq("active", true);
        return (fallback ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          schedule_days: `${p.training_days_per_week ?? 0}x por semana`,
          schedule_time: "Consulte a academia",
          student_count: 0,
        }));
      }
      return data ?? [];
    },
  });
}

export function useStaffProfiles() {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["staff", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, full_name, whatsapp, academy_id")
        .eq("academy_id", academyId!);

      if (profilesError) throw profilesError;
      if (!profiles?.length) return [];

      const userIds = profiles.map((profile) => profile.user_id);
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds)
        .in("role", ["admin", "professor"]);

      if (rolesError) throw rolesError;

      const profileByUserId = new Map(profiles.map((profile) => [profile.user_id, profile]));
      const staffMap = new Map<string, { user_id: string; full_name: string; whatsapp: string | null; roles: string[] }>();
      for (const row of roles ?? []) {
        const profile = profileByUserId.get(row.user_id);
        if (!profile) continue;
        const existing = staffMap.get(profile.user_id) ?? { ...profile, roles: [] as string[] };
        existing.roles.push(row.role);
        staffMap.set(profile.user_id, existing);
      }
      return Array.from(staffMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });
}

export function useDashboardStats() {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["dashboard-stats", academyId],
    enabled: !!academyId,
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const [
        { count: totalStudents },
        { count: activeStudents },
        { count: inactiveStudents },
        { count: presentToday },
        { count: overdueCount },
        { data: monthBillings },
        { data: yearBillings },
        { data: dueSoon },
        { data: recentStudents },
        { data: recentGraduations },
        { count: activeFamilyGroups },
        { count: activeContracts },
      ] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("academy_id", academyId!),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("status", "ativo"),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("status", "inativo"),
        supabase.from("attendances").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).gte("checked_in_at", todayStart.toISOString()),
        supabase.from("billings").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("status", "vencido"),
        supabase.from("billings").select("amount").eq("academy_id", academyId!).eq("status", "pago").gte("reference_month", monthStart),
        supabase.from("billings").select("amount").eq("academy_id", academyId!).eq("status", "pago").gte("reference_month", yearStart),
        supabase.from("billings").select("*, students(full_name)").eq("academy_id", academyId!).in("status", ["pendente", "gerado", "enviado_whatsapp"]).gte("due_date", monthStart).lte("due_date", new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10)).limit(10),
        supabase.from("students").select("full_name, created_at").eq("academy_id", academyId!).order("created_at", { ascending: false }).limit(5),
        supabase.from("students").select("full_name, belt, degrees, updated_at").eq("academy_id", academyId!).order("updated_at", { ascending: false }).limit(5),
        supabase.from("family_groups").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("status", "ativo"),
        supabase.from("student_contracts").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("contract_status", "ativo"),
      ]);

      const monthRevenue = (monthBillings ?? []).reduce((s, b) => s + Number(b.amount), 0);
      const yearRevenue = (yearBillings ?? []).reduce((s, b) => s + Number(b.amount), 0);

      return {
        totalStudents: totalStudents ?? 0,
        activeStudents: activeStudents ?? 0,
        inactiveStudents: inactiveStudents ?? 0,
        presentToday: presentToday ?? 0,
        overdueCount: overdueCount ?? 0,
        activeFamilyGroups: activeFamilyGroups ?? 0,
        activeContracts: activeContracts ?? 0,
        monthRevenue,
        yearRevenue,
        dueSoon: dueSoon ?? [],
        recentStudents: recentStudents ?? [],
        recentGraduations: recentGraduations ?? [],
      };
    },
  });
}

export function useRanking() {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["ranking", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: students, error } = await supabase
        .from("students")
        .select("id, full_name, belt, degrees")
        .eq("academy_id", academyId!)
        .eq("status", "ativo");

      if (error) throw error;

      const { data: attendances } = await supabase
        .from("attendances")
        .select("student_id")
        .eq("academy_id", academyId!)
        .gte("checked_in_at", monthAgo);

      const counts = new Map<string, number>();
      for (const a of attendances ?? []) {
        counts.set(a.student_id, (counts.get(a.student_id) ?? 0) + 1);
      }

      return (students ?? [])
        .map((s) => ({ ...s, treinos: counts.get(s.id) ?? 0 }))
        .sort((a, b) => b.treinos - a.treinos)
        .slice(0, 20);
    },
  });
}

export function useAcademySettings(options?: { basicOnly?: boolean }) {
  const { data: academyId } = useAcademyId();
  const basicOnly = options?.basicOnly === true;
  return useQuery({
    queryKey: ["academy-settings", academyId, basicOnly ? "basic" : "full"],
    enabled: !!academyId,
    queryFn: async () => {
      // academy_limited: RPC segura (sem SELECT em public.academies / campos sensíveis)
      if (basicOnly) {
        const { data, error } = await supabase.rpc("get_my_academy_basic_info");
        if (error) throw error;
        const academy = Array.isArray(data) ? data[0] ?? null : data;
        return { academy, billing: null };
      }

      const [{ data: academy, error: academyError }, { data: billing }] = await Promise.all([
        supabase.from("academies").select("*").eq("id", academyId!).single(),
        supabase.from("academy_billing_settings").select("*").eq("academy_id", academyId!).maybeSingle(),
      ]);
      if (academyError) throw academyError;
      return { academy, billing };
    },
  });
}
