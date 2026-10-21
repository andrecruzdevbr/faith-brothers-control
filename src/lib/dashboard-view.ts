export type DashboardStatsSnapshot = {
  totalStudents: number;
  activeContracts: number;
  monthRevenue: number;
};

export type DashboardView =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stats: DashboardStatsSnapshot };

export function dashboardErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro ao carregar o dashboard.";
}

export function resolveDashboardView(input: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  stats?: DashboardStatsSnapshot | null;
}): DashboardView {
  if (input.isLoading) return { status: "loading" };
  if (input.isError) {
    return { status: "error", message: dashboardErrorMessage(input.error) };
  }
  if (!input.stats) return { status: "loading" };
  return { status: "ready", stats: input.stats };
}

export function isLegitimateEmptyDashboard(stats: DashboardStatsSnapshot): boolean {
  return stats.totalStudents === 0 && stats.activeContracts === 0 && stats.monthRevenue === 0;
}

export function throwIfQueryFailed(
  results: Array<{ error: { message: string } | null } | null | undefined>,
): void {
  for (const result of results) {
    if (result?.error) throw new Error(result.error.message);
  }
}

export type QuerySectionView =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready" };

export function resolveQuerySectionView(input: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  empty: boolean;
  fallbackMessage?: string;
}): QuerySectionView {
  if (input.isLoading) return { status: "loading" };
  if (input.isError) {
    return {
      status: "error",
      message: input.error instanceof Error ? input.error.message : (input.fallbackMessage ?? "Erro ao carregar."),
    };
  }
  if (input.empty) return { status: "empty" };
  return { status: "ready" };
}

export type StudentStatusSlice = { name: string; value: number; color: string };

export function buildStudentStatusChart(input: {
  active: number;
  inactive: number;
  pending: number;
  rejected: number;
}): { kind: "no-students" | "chart"; message: string; slices: StudentStatusSlice[] } {
  const total = input.active + input.inactive + input.pending + input.rejected;
  const slices: StudentStatusSlice[] = [
    { name: "Ativos", value: input.active, color: "hsl(142, 71%, 45%)" },
    { name: "Inativos", value: input.inactive, color: "hsl(0, 0%, 40%)" },
    { name: "Pendentes", value: input.pending, color: "hsl(38, 92%, 50%)" },
    { name: "Rejeitados", value: input.rejected, color: "hsl(0, 0%, 55%)" },
  ].filter((d) => d.value > 0);

  if (total === 0) {
    return { kind: "no-students", message: "Sem alunos cadastrados.", slices: [] };
  }
  if (input.active === 0 && input.inactive === 0 && (input.pending > 0 || input.rejected > 0)) {
    const parts: string[] = [];
    if (input.pending > 0) parts.push(`${input.pending} pendente(s)`);
    if (input.rejected > 0) parts.push(`${input.rejected} rejeitado(s)`);
    return {
      kind: "chart",
      message: `Há ${parts.join(" e ")}, mas nenhum ativo ou inativo.`,
      slices,
    };
  }
  return { kind: "chart", message: "", slices };
}
