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
