import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Users,
  DollarSign,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryLoadError } from "@/components/QueryLoadError";
import { StatsCard } from "@/components/StatsCard";
import { useBeltDistribution, useDashboardStats, useReportBillings, useRanking } from "@/hooks/useQueries";
import { BILLING_STATUS_LABELS } from "@/lib/constants";
import { buildBeltDistribution } from "@/lib/belt-rank";
import { buildStudentStatusChart } from "@/lib/dashboard-view";
import { buildMonthlyReceiptSeries, formatFinanceAxisTick } from "@/lib/finance-indicators";
import { formatCurrency } from "@/lib/api";

const CHART_TOOLTIP = {
  background: "hsl(0, 0%, 10%)",
  border: "1px solid hsl(0, 0%, 18%)",
  borderRadius: "8px",
  color: "hsl(0, 0%, 95%)",
};

const BELT_COLORS: Record<string, string> = {
  Branca: "hsl(0, 0%, 85%)",
  Cinza: "hsl(0, 0%, 60%)",
  Amarela: "hsl(45, 90%, 55%)",
  Laranja: "hsl(25, 90%, 50%)",
  Verde: "hsl(140, 60%, 40%)",
  Azul: "hsl(220, 80%, 50%)",
  Roxa: "hsl(270, 60%, 50%)",
  Marrom: "hsl(30, 60%, 35%)",
  Preta: "hsl(0, 0%, 20%)",
};

const RelatoriosSkeleton = () => (
  <div className="space-y-6">
    <Skeleton className="h-10 w-52" />
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  </div>
);

const Relatorios = () => {
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    error: statsErr,
    refetch: refetchStats,
  } = useDashboardStats();
  const {
    data: billingsData,
    isLoading: billingsLoading,
    isError: billingsError,
    error: billingsErr,
    refetch: refetchBillings,
  } = useReportBillings();
  const {
    data: ranking,
    isLoading: rankingLoading,
    isError: rankingError,
    error: rankingErr,
    refetch: refetchRanking,
  } = useRanking();
  const {
    data: beltStudents,
    isLoading: beltsLoading,
    isError: beltsError,
    error: beltsErr,
    refetch: refetchBelts,
  } = useBeltDistribution();

  const isLoading = statsLoading || billingsLoading;
  const isError = statsError || billingsError;

  const alunosStatusChart = useMemo(() => {
    if (!stats) {
      return { kind: "no-students" as const, message: "Sem alunos cadastrados.", slices: [] };
    }
    return buildStudentStatusChart({
      active: stats.activeStudents,
      inactive: stats.inactiveStudents,
      pending: stats.pendingStudents,
      rejected: stats.rejectedStudents,
    });
  }, [stats]);
  const alunosStatusData = alunosStatusChart.slices;

  const rankingChartData = useMemo(() => {
    return (ranking ?? []).slice(0, 10).map((s) => ({
      nome: s.full_name.split(" ")[0],
      treinos: s.treinos,
    }));
  }, [ranking]);

  const faixaDistribuicao = useMemo(() => {
    return buildBeltDistribution(beltStudents ?? []).map((row) => ({
      ...row,
      color: BELT_COLORS[row.name] ?? "hsl(0, 0%, 50%)",
    }));
  }, [beltStudents]);

  const faturamentoMensal = useMemo(() => {
    return buildMonthlyReceiptSeries({
      billings: (billingsData?.billings ?? []).map((row) => ({
        studentId: row.student_id,
        referenceMonth: row.reference_month,
        amount: Number(row.amount),
        status: row.status,
      })),
      coveredMonths: (billingsData?.coveredMonths ?? []).map((row) => ({
        studentId: row.student_id,
        referenceMonth: row.reference_month,
      })),
      contractPayments: (billingsData?.contractPayments ?? []).map((row) => ({
        amount: Number(row.amount),
        confirmedAt: row.confirmed_at,
      })),
    });
  }, [billingsData]);

  const cobrancasStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of billingsData?.billings ?? []) {
      counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, qtd]) => ({
      status: BILLING_STATUS_LABELS[status] ?? status,
      qtd,
    }));
  }, [billingsData]);

  if (isLoading) return <RelatoriosSkeleton />;

  if (isError) {
    return (
      <QueryLoadError
        title="RELATÓRIOS"
        message={
          statsErr instanceof Error
            ? statsErr.message
            : billingsErr instanceof Error
              ? billingsErr.message
              : "Erro ao carregar relatórios."
        }
        onRetry={() => {
          void refetchStats();
          void refetchBillings();
          void refetchRanking();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">RELATÓRIOS</h1>
        <p className="text-sm text-muted-foreground mt-1">Indicadores e gráficos da academia</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total de Alunos"
          value={stats?.totalStudents ?? 0}
          icon={Users}
          variant="primary"
        />
        <StatsCard
          title="Faturamento do Mês"
          value={formatCurrency(stats?.monthRevenue ?? 0)}
          icon={DollarSign}
          variant="success"
        />
        <StatsCard
          title="Presentes Hoje"
          value={stats?.presentToday ?? 0}
          icon={TrendingUp}
          variant="default"
        />
        <StatsCard
          title="Inadimplentes"
          value={stats?.overdueCount ?? 0}
          icon={AlertCircle}
          variant="destructive"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <h3 className="font-display text-lg font-bold tracking-wider mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            TOP 10 — TREINOS (30 DIAS)
          </h3>
          {rankingLoading ? (
            <Skeleton className="h-[250px] w-full rounded-lg" />
          ) : rankingError ? (
            <QueryLoadError
              compact
              message={rankingErr instanceof Error ? rankingErr.message : "Erro ao carregar o ranking."}
              onRetry={() => {
                void refetchRanking();
              }}
            />
          ) : rankingChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">Sem dados de presença.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={rankingChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 18%)" />
                <XAxis dataKey="nome" stroke="hsl(0, 0%, 55%)" fontSize={12} />
                <YAxis stroke="hsl(0, 0%, 55%)" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP} />
                <Bar dataKey="treinos" fill="hsl(355, 87%, 41%)" radius={[6, 6, 0, 0]} name="Treinos" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <h3 className="font-display text-lg font-bold tracking-wider mb-4">ALUNOS POR STATUS</h3>
          {alunosStatusChart.kind === "no-students" ? (
            <p className="text-sm text-muted-foreground py-16 text-center">{alunosStatusChart.message}</p>
          ) : (
            <>
            {alunosStatusChart.message ? (
              <p className="text-xs text-muted-foreground mb-2">{alunosStatusChart.message}</p>
            ) : null}
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={alunosStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {alunosStatusData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
            </>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <h3 className="font-display text-lg font-bold tracking-wider mb-4">FATURAMENTO POR MÊS</h3>
          {faturamentoMensal.every((row) => row.valor === 0) ? (
            <p className="text-sm text-muted-foreground py-16 text-center">Nenhum pagamento registrado.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={faturamentoMensal}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 18%)" />
                <XAxis dataKey="mes" stroke="hsl(0, 0%, 55%)" fontSize={12} />
                <YAxis
                  stroke="hsl(0, 0%, 55%)"
                  fontSize={12}
                  allowDecimals={false}
                  tickFormatter={(v) => formatFinanceAxisTick(v, faturamentoMensal.map((row) => row.valor))}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                  formatter={(value: number) => [formatCurrency(value), "Receita"]}
                />
                <Bar dataKey="valor" fill="hsl(142, 71%, 45%)" radius={[6, 6, 0, 0]} name="Receita" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <h3 className="font-display text-lg font-bold tracking-wider mb-4">DISTRIBUIÇÃO POR FAIXA</h3>
          {beltsLoading ? (
            <Skeleton className="h-[250px] w-full rounded-lg" />
          ) : beltsError ? (
            <QueryLoadError
              compact
              message={beltsErr instanceof Error ? beltsErr.message : "Erro ao carregar a distribuição de faixas."}
              onRetry={() => {
                void refetchBelts();
              }}
            />
          ) : faixaDistribuicao.length === 0 ? (
            <p className="text-sm text-muted-foreground py-16 text-center">Sem dados de faixas.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={faixaDistribuicao}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {faixaDistribuicao.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      {cobrancasStatus.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card p-5 shadow-card"
        >
          <h3 className="font-display text-lg font-bold tracking-wider mb-4">COBRANÇAS DOS ÚLTIMOS 6 MESES POR STATUS</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cobrancasStatus} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 18%)" />
              <XAxis type="number" stroke="hsl(0, 0%, 55%)" fontSize={12} allowDecimals={false} />
              <YAxis type="category" dataKey="status" stroke="hsl(0, 0%, 55%)" fontSize={12} width={100} />
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Bar dataKey="qtd" fill="hsl(220, 80%, 50%)" radius={[0, 6, 6, 0]} name="Quantidade" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}
    </div>
  );
};

export default Relatorios;
