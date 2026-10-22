import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, UserCheck, UserX, DollarSign, AlertTriangle, CalendarClock,
  GraduationCap, UserPlus, Trophy, TrendingUp,
} from "lucide-react";
import { QueryLoadError } from "@/components/QueryLoadError";
import { StatsCard } from "@/components/StatsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAcademyId, useDashboardStats, useRanking, useReportBillings } from "@/hooks/useQueries";
import { formatCurrency, formatDateBR } from "@/lib/api";
import { resolveDashboardView } from "@/lib/dashboard-view";
import { buildEvasionRisk } from "@/lib/evasion-risk";
import { buildMonthlyReceiptSeries, formatFinanceAxisTick } from "@/lib/finance-indicators";
import { fetchAllRows } from "@/lib/paged-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar,
} from "recharts";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const chartTooltipStyle = {
  background: "hsl(0, 0%, 10%)",
  border: "1px solid hsl(0, 0%, 18%)",
  borderRadius: "8px",
  color: "hsl(0, 0%, 95%)",
};

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

const Dashboard = () => {
  const { data: academyId } = useAcademyId();
  const {
    data: stats,
    isLoading: loadingStats,
    isError: statsError,
    error: statsErr,
    refetch: refetchStats,
  } = useDashboardStats();
  const { data: ranking, isLoading: loadingRanking, isError: rankingError, error: rankingErr, refetch: refetchRanking } = useRanking();
  const {
    data: receiptRows,
    isLoading: loadingRevenue,
    isError: revenueError,
    error: revenueErr,
    refetch: refetchRevenue,
  } = useReportBillings();
  const revenueChart = useMemo(
    () =>
      buildMonthlyReceiptSeries({
        billings: (receiptRows?.billings ?? []).map((row) => ({
          studentId: row.student_id,
          referenceMonth: row.reference_month,
          amount: Number(row.amount),
          status: row.status,
        })),
        coveredMonths: (receiptRows?.coveredMonths ?? []).map((row) => ({
          studentId: row.student_id,
          referenceMonth: row.reference_month,
        })),
        contractPayments: (receiptRows?.contractPayments ?? []).map((row) => ({
          amount: Number(row.amount),
          confirmedAt: row.confirmed_at,
        })),
      }),
    [receiptRows],
  );
  const revenueAxisTick = useMemo(
    () => (value: number) => formatFinanceAxisTick(value, revenueChart.map((row) => row.valor)),
    [revenueChart],
  );
  const statsView = resolveDashboardView({
    isLoading: loadingStats,
    isError: statsError,
    error: statsErr,
    stats: stats
      ? {
          totalStudents: stats.totalStudents,
          activeContracts: stats.activeContracts,
          monthRevenue: stats.monthRevenue,
        }
      : null,
  });

  const { data: frequencyChart, isLoading: loadingFrequency, isError: frequencyError, error: frequencyErr, refetch: refetchFrequency } = useQuery({
    queryKey: ["dashboard-frequency-chart", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const data = await fetchAllRows<{ student_id: string; checked_in_at: string }>((from, to) =>
        supabase
          .from("attendances")
          .select("student_id, checked_in_at")
          .eq("academy_id", academyId!)
          .gte("checked_in_at", weekStart.toISOString())
          .range(from, to),
      );

      const counts = [0, 0, 0, 0, 0, 0, 0];
      const seen = Array.from({ length: 7 }, () => new Set<string>());
      for (const a of data) {
        const day = new Date(a.checked_in_at).getDay();
        if (!seen[day].has(a.student_id)) {
          seen[day].add(a.student_id);
          counts[day]++;
        }
      }
      return WEEKDAYS.map((dia, i) => ({ dia, alunos: counts[i] }));
    },
  });

  const { data: evasionRisk, isLoading: loadingEvasion, isError: evasionError, error: evasionErr, refetch: refetchEvasion } = useQuery({
    queryKey: ["dashboard-evasion", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      const [students, recentAtts, overdueBills] = await Promise.all([
        fetchAllRows<{ id: string; full_name: string; created_at: string }>((from, to) =>
          supabase.from("students").select("id, full_name, created_at").eq("academy_id", academyId!).eq("status", "ativo").range(from, to),
        ).then((data) => ({ data, error: null as { message: string } | null })),
        fetchAllRows<{ student_id: string; checked_in_at: string }>((from, to) =>
          supabase.from("attendances").select("student_id, checked_in_at").eq("academy_id", academyId!).gte("checked_in_at", twoWeeksAgo).range(from, to),
        ).then((data) => ({ data, error: null as { message: string } | null })),
        fetchAllRows<{ student_id: string }>((from, to) =>
          supabase.from("billings").select("student_id").eq("academy_id", academyId!).eq("status", "vencido").range(from, to),
        ).then((data) => ({ data, error: null as { message: string } | null })),
      ]);

      return buildEvasionRisk({
        students,
        attendances: recentAtts,
        overdueBills,
      });
    },
  });

  const topRanking = useMemo(() => (ranking ?? []).slice(0, 5), [ranking]);

  const riskStyles = {
    alto: { bg: "bg-destructive/10 border-destructive/30", text: "text-destructive", label: "Alto" },
    medio: { bg: "bg-warning/10 border-warning/30", text: "text-warning", label: "Médio" },
    baixo: { bg: "bg-success/10 border-success/30", text: "text-success", label: "Baixo" },
  };

  if (statsView.status === "loading") {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (statsView.status === "error") {
    return (
      <QueryLoadError
        title="DASHBOARD"
        message={statsView.message}
        onRetry={() => {
          void refetchStats();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">DASHBOARD</h1>
        <p className="text-sm text-muted-foreground mt-1">Visão geral da academia</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total de Alunos" value={stats?.totalStudents ?? 0} icon={Users} variant="default" />
        <StatsCard title="Alunos Ativos" value={stats?.activeStudents ?? 0} icon={UserCheck} variant="primary" />
        <StatsCard title="Alunos Inativos" value={stats?.inactiveStudents ?? 0} icon={UserX} variant="destructive" />
        <StatsCard title="Presentes Hoje" value={stats?.presentToday ?? 0} icon={UserCheck} variant="success" />
        <StatsCard title="Grupos familiares" value={stats?.activeFamilyGroups ?? 0} icon={Users} variant="default" />
        <StatsCard title="Contratos ativos" value={stats?.activeContracts ?? 0} icon={CalendarClock} variant="default" />
        <StatsCard title="Faturamento Mês" value={formatCurrency(stats?.monthRevenue ?? 0)} icon={DollarSign} variant="primary" />
        <StatsCard title="Faturamento Ano" value={formatCurrency(stats?.yearRevenue ?? 0)} icon={TrendingUp} variant="default" />
        <StatsCard title="Inadimplentes" value={stats?.overdueCount ?? 0} icon={AlertTriangle} variant="destructive" />
        <StatsCard title="Vence em 7 dias" value={stats?.dueSoon?.length ?? 0} icon={CalendarClock} variant="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h3 className="font-display text-lg font-bold tracking-wider mb-4">FATURAMENTO MENSAL</h3>
          {loadingRevenue ? (
            <Skeleton className="h-[250px] w-full rounded-lg" />
          ) : revenueError ? (
            <QueryLoadError
              compact
              message={revenueErr instanceof Error ? revenueErr.message : "Erro ao carregar o faturamento mensal."}
              onRetry={() => {
                void refetchRevenue();
              }}
            />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={revenueChart}>
                <defs>
                  <linearGradient id="faturamentoGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(355, 87%, 41%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(355, 87%, 41%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 18%)" />
                <XAxis dataKey="mes" stroke="hsl(0, 0%, 55%)" fontSize={12} />
                <YAxis stroke="hsl(0, 0%, 55%)" fontSize={12} tickFormatter={revenueAxisTick} allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [formatCurrency(v), "Receita"]} />
                <Area type="monotone" dataKey="valor" stroke="hsl(355, 87%, 41%)" strokeWidth={2} fill="url(#faturamentoGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }} className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h3 className="font-display text-lg font-bold tracking-wider mb-4">FREQUÊNCIA SEMANAL</h3>
          {loadingFrequency ? (
            <Skeleton className="h-[250px] w-full rounded-lg" />
          ) : frequencyError ? (
            <QueryLoadError
              compact
              message={frequencyErr instanceof Error ? frequencyErr.message : "Erro ao carregar a frequência semanal."}
              onRetry={() => {
                void refetchFrequency();
              }}
            />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={frequencyChart ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 18%)" />
                <XAxis dataKey="dia" stroke="hsl(0, 0%, 55%)" fontSize={12} />
                <YAxis stroke="hsl(0, 0%, 55%)" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => [v, "Alunos"]} />
                <Bar dataKey="alunos" fill="hsl(355, 87%, 41%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }} className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold tracking-wider">NOVOS ALUNOS</h3>
          </div>
          <div className="space-y-2">
            {(stats?.recentStudents ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum aluno cadastrado recentemente.</p>
            ) : (
              stats?.recentStudents.map((s, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <p className="text-sm font-medium text-foreground">{s.full_name}</p>
                  <p className="text-xs text-muted-foreground">{formatDateBR(s.created_at.slice(0, 10))}</p>
                </div>
              ))
            )}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }} className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold tracking-wider">GRADUAÇÕES RECENTES</h3>
          </div>
          <div className="space-y-2">
            {(stats?.recentGraduations ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma graduação recente.</p>
            ) : (
              stats?.recentGraduations.map((s, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <div>
                    <p className="text-sm font-medium text-foreground">{s.full_name}</p>
                    <p className="text-xs text-muted-foreground">{s.belt ?? "Branca"}{s.degrees > 0 ? ` • ${s.degrees}º grau` : ""}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateBR(s.updated_at.slice(0, 10))}</p>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      {(stats?.dueSoon ?? []).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }} className="rounded-xl border border-warning/30 bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <CalendarClock className="h-5 w-5 text-warning" />
            <h3 className="font-display text-lg font-bold tracking-wider">COBRANÇAS A VENCER</h3>
          </div>
          <div className="space-y-2">
            {stats?.dueSoon.map((b) => {
              const student = Array.isArray(b.students) ? b.students[0] : b.students;
              return (
                <div key={b.id} className="flex items-center justify-between p-3 rounded-lg bg-warning/10 border border-warning/20">
                  <p className="text-sm font-medium text-foreground">{student?.full_name ?? "—"}</p>
                  <div className="text-right">
                    <p className="text-sm font-display font-bold text-foreground">{formatCurrency(Number(b.amount))}</p>
                    <p className="text-xs text-muted-foreground">Vence {formatDateBR(b.due_date)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.35 }} className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold tracking-wider">RANKING DO MÊS</h3>
          </div>
          {loadingRanking ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : rankingError ? (
            <QueryLoadError
              compact
              message={rankingErr instanceof Error ? rankingErr.message : "Erro ao carregar o ranking."}
              onRetry={() => {
                void refetchRanking();
              }}
            />
          ) : topRanking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum treino registrado nos últimos 30 dias.</p>
          ) : (
            <div className="space-y-3">
              {topRanking.map((aluno, i) => {
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <div key={aluno.id} className={`flex items-center gap-3 p-3 rounded-lg ${i === 0 ? "bg-primary/10 border border-primary/20" : "bg-secondary/50"}`}>
                    <span className="text-lg w-8 text-center">{i < 3 ? medals[i] : `${i + 1}º`}</span>
                    <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                      {getInitials(aluno.full_name)}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{aluno.full_name}</p>
                      <p className="text-xs text-muted-foreground">{aluno.belt ?? "Branca"}</p>
                    </div>
                    <span className="text-sm font-display font-bold text-primary">{aluno.treinos}</span>
                    <span className="text-xs text-muted-foreground">treinos</span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.4 }} className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <h3 className="font-display text-lg font-bold tracking-wider">RISCO DE EVASÃO</h3>
          </div>
          {loadingEvasion ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : evasionError ? (
            <QueryLoadError
              compact
              message={evasionErr instanceof Error ? evasionErr.message : "Erro ao carregar o risco de evasão."}
              onRetry={() => {
                void refetchEvasion();
              }}
            />
          ) : (evasionRisk ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum aluno em risco no momento.</p>
          ) : (
            <div className="space-y-3">
              {evasionRisk?.map((aluno) => {
                const style = riskStyles[aluno.risco];
                return (
                  <div key={aluno.full_name} className={`flex items-center gap-3 p-3 rounded-lg border ${style.bg}`}>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{aluno.full_name}</p>
                      <p className="text-xs text-muted-foreground">{aluno.dias >= 99 ? "Sem presença registrada" : `${aluno.dias} dias sem treinar`} • {aluno.reason}</p>
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${style.text} ${style.bg}`}>{style.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;
