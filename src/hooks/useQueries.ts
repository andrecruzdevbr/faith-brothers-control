import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { PAGE_SIZE } from "@/lib/constants";
import { isMissingBeltChangesRpc } from "@/lib/belt-events";
import { throwIfQueryFailed } from "@/lib/dashboard-view";
import {
  addDaysIso,
  countDelinquentStudents,
  isDueSoon,
  sumReceipts,
} from "@/lib/finance-indicators";

async function fetchAllRows<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let page = 0; page < 20; page++) {
    const from = page * pageSize;
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

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
        .select("*, plans(name, monthly_price, package_total_amount, duration_months, billing_mode, allows_installments, max_installments, training_days_per_week, audience, plan_kind)", { count: "exact" })
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

export function useReportBillings() {
  const { data: academyId } = useAcademyId();
  return useQuery({
    queryKey: ["report-billings", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 5, 1);
      const sinceIso = since.toISOString().slice(0, 10);
      const [billings, coveredMonths, contractRows] = await Promise.all([
        fetchAllRows<{
          student_id: string;
          status: string;
          amount: number;
          reference_month: string;
        }>((from, to) =>
          supabase
            .from("billings")
            .select("student_id, status, amount, reference_month")
            .eq("academy_id", academyId!)
            .order("reference_month", { ascending: false })
            .range(from, to),
        ),
        fetchAllRows<{ student_id: string; reference_month: string }>((from, to) =>
          supabase
            .from("student_contract_months")
            .select("student_id, reference_month")
            .eq("academy_id", academyId!)
            .eq("status", "pago")
            .gte("reference_month", sinceIso)
            .range(from, to),
        ),
        fetchAllRows<{ id: string }>((from, to) =>
          supabase.from("student_contracts").select("id").eq("academy_id", academyId!).range(from, to),
        ),
      ]);
      const contractPayments: { amount: number; confirmed_at: string }[] = [];
      for (let index = 0; index < contractRows.length; index += 100) {
        const slice = contractRows.slice(index, index + 100).map((row) => row.id);
        const batch = await fetchAllRows<{ amount: number; confirmed_at: string }>((from, to) =>
          supabase
            .from("contract_payments")
            .select("amount, confirmed_at")
            .in("contract_id", slice)
            .eq("action", "confirm")
            .gte("confirmed_at", `${sinceIso}T00:00:00`)
            .range(from, to),
        );
        contractPayments.push(...batch);
      }
      return { billings, coveredMonths, contractPayments, total: billings.length };
    },
  });
}

export function useMyBillings() {
  return useQuery({
    queryKey: ["my-billings"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: student } = await supabase
        .from("students")
        .select(
          "id, plan_id, status, approved_at, payment_review_status, registration_audience, requested_training_days, requested_payment_method, plans(id, name, monthly_price, package_total_amount, duration_months, billing_mode, plan_kind, training_days_per_week, audience)",
        )
        .eq("profile_user_id", user.id)
        .maybeSingle();
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

export function useClasses(options?: { includeInactive?: boolean }) {
  const { data: academyId } = useAcademyId();
  const includeInactive = options?.includeInactive === true;
  return useQuery({
    queryKey: ["classes", academyId, includeInactive ? "all" : "active"],
    enabled: !!academyId,
    queryFn: async () => {
      let query = supabase
        .from("classes")
        .select("*")
        .eq("academy_id", academyId!)
        .not("day_of_week", "is", null)
        .not("start_time", "is", null)
        .order("day_of_week", { ascending: true })
        .order("start_time", { ascending: true })
        .order("sort_order", { ascending: true });
      if (!includeInactive) {
        query = query.eq("active", true);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePublicClassSchedules(academyId?: string | null) {
  return useQuery({
    queryKey: ["public-class-schedules", academyId ?? "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_class_schedules", {
        _academy_id: academyId || null,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        notes: row.notes ?? null,
      }));
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
      const today = now.toISOString().slice(0, 10);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const dueSoonEnd = addDaysIso(today, 7);

      const [
        totalStudentsRes,
        activeStudentsRes,
        inactiveStudentsRes,
        presentTodayRes,
        openBillings,
        monthBillings,
        yearBillings,
        dueSoonRows,
        recentStudentsRes,
        graduationsRes,
        activeFamilyGroupsRes,
        activeContractsRes,
        contractRows,
        coveredMonths,
      ] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("academy_id", academyId!),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("status", "ativo"),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("status", "inativo"),
        supabase.from("attendances").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).gte("checked_in_at", todayStart.toISOString()),
        fetchAllRows<{ student_id: string; status: string; due_date: string }>((from, to) =>
          supabase
            .from("billings")
            .select("student_id, status, due_date")
            .eq("academy_id", academyId!)
            .in("status", ["pendente", "gerado", "enviado_whatsapp", "vencido"])
            .range(from, to),
        ),
        fetchAllRows<{ student_id: string; amount: number; reference_month: string }>((from, to) =>
          supabase
            .from("billings")
            .select("student_id, amount, reference_month")
            .eq("academy_id", academyId!)
            .eq("status", "pago")
            .gte("reference_month", monthStart)
            .range(from, to),
        ),
        fetchAllRows<{ student_id: string; amount: number; reference_month: string }>((from, to) =>
          supabase
            .from("billings")
            .select("student_id, amount, reference_month")
            .eq("academy_id", academyId!)
            .eq("status", "pago")
            .gte("reference_month", yearStart)
            .range(from, to),
        ),
        fetchAllRows<{ id: string; due_date: string; status: string; amount: number; students: { full_name: string } | null }>((from, to) =>
          supabase
            .from("billings")
            .select("id, due_date, status, amount, students(full_name)")
            .eq("academy_id", academyId!)
            .in("status", ["pendente", "gerado", "enviado_whatsapp"])
            .gte("due_date", today)
            .lte("due_date", dueSoonEnd)
            .order("due_date")
            .range(from, to),
        ),
        supabase.from("students").select("full_name, created_at").eq("academy_id", academyId!).order("created_at", { ascending: false }).limit(5),
        supabase.rpc("get_recent_belt_changes", { _limit: 8 }),
        supabase.from("family_groups").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("status", "ativo"),
        supabase.from("student_contracts").select("id", { count: "exact", head: true }).eq("academy_id", academyId!).eq("contract_status", "ativo").gte("ends_on", today),
        fetchAllRows<{ id: string }>((from, to) =>
          supabase.from("student_contracts").select("id").eq("academy_id", academyId!).range(from, to),
        ),
        fetchAllRows<{ student_id: string; reference_month: string }>((from, to) =>
          supabase
            .from("student_contract_months")
            .select("student_id, reference_month")
            .eq("academy_id", academyId!)
            .eq("status", "pago")
            .gte("reference_month", yearStart)
            .range(from, to),
        ),
      ]);

      throwIfQueryFailed([
        totalStudentsRes,
        activeStudentsRes,
        inactiveStudentsRes,
        presentTodayRes,
        recentStudentsRes,
        activeFamilyGroupsRes,
        activeContractsRes,
      ]);
      // Belt history starts empty until the audit migration is applied / events exist.
      // Missing RPC must not invent graduations or break the whole dashboard.
      let recentGraduations: {
        full_name: string;
        belt: string;
        degrees: number;
        updated_at: string;
      }[] = [];
      if (graduationsRes.error) {
        if (!isMissingBeltChangesRpc(graduationsRes.error)) {
          throw new Error(graduationsRes.error.message);
        }
      } else {
        recentGraduations = (graduationsRes.data ?? []).map((row) => ({
          full_name: row.full_name,
          belt: row.belt,
          degrees: row.degrees,
          updated_at: row.changed_at,
        }));
      }

      const contractIds = contractRows.map((row) => row.id);
      const confirmedPayments: { amount: number; confirmed_at: string }[] = [];
      for (let index = 0; index < contractIds.length; index += 100) {
        const slice = contractIds.slice(index, index + 100);
        const batch = await fetchAllRows<{ amount: number; confirmed_at: string }>((from, to) =>
          supabase
            .from("contract_payments")
            .select("amount, confirmed_at")
            .in("contract_id", slice)
            .eq("action", "confirm")
            .gte("confirmed_at", `${yearStart}T00:00:00`)
            .range(from, to),
        );
        confirmedPayments.push(...batch);
      }
      const monthPayments = confirmedPayments.filter((row) => row.confirmed_at >= `${monthStart}T00:00:00`);
      const yearPayments = confirmedPayments;

      const covered = (coveredMonths ?? []).map((row) => ({
        studentId: row.student_id,
        referenceMonth: row.reference_month,
      }));
      const monthRevenue = sumReceipts({
        billings: monthBillings.map((row) => ({
          studentId: row.student_id,
          referenceMonth: row.reference_month,
          amount: Number(row.amount),
        })),
        coveredMonths: covered.filter((row) => row.referenceMonth >= monthStart),
        contractPayments: monthPayments,
      });
      const yearRevenue = sumReceipts({
        billings: yearBillings.map((row) => ({
          studentId: row.student_id,
          referenceMonth: row.reference_month,
          amount: Number(row.amount),
        })),
        coveredMonths: covered,
        contractPayments: yearPayments,
      });

      const dueSoon = dueSoonRows.filter((row) =>
        isDueSoon(
          { studentId: "", status: row.status, dueDate: row.due_date },
          today,
        ),
      );

      return {
        totalStudents: totalStudentsRes.count ?? 0,
        activeStudents: activeStudentsRes.count ?? 0,
        inactiveStudents: inactiveStudentsRes.count ?? 0,
        presentToday: presentTodayRes.count ?? 0,
        overdueCount: countDelinquentStudents(
          openBillings.map((row) => ({
            studentId: row.student_id,
            status: row.status,
            dueDate: row.due_date,
          })),
          today,
        ),
        activeFamilyGroups: activeFamilyGroupsRes.count ?? 0,
        activeContracts: activeContractsRes.count ?? 0,
        monthRevenue,
        yearRevenue,
        dueSoon,
        recentStudents: recentStudentsRes.data ?? [],
        recentGraduations,
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

      const { data: attendances, error: attendanceError } = await supabase
        .from("attendances")
        .select("student_id")
        .eq("academy_id", academyId!)
        .gte("checked_in_at", monthAgo);

      if (attendanceError) throw new Error(attendanceError.message);

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

type AcademyRow = Database["public"]["Tables"]["academies"]["Row"];
type BasicAcademy = Database["public"]["Functions"]["get_my_academy_basic_info"]["Returns"][number];

export function isFullAcademy(
  academy: AcademyRow | BasicAcademy | null | undefined,
): academy is AcademyRow {
  return !!academy && "bank_name" in academy;
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
