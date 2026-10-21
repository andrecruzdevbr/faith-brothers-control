import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryLoadError } from "@/components/QueryLoadError";
import {
  buildStudentStatusChart,
  isLegitimateEmptyDashboard,
  resolveDashboardView,
  throwIfQueryFailed,
} from "@/lib/dashboard-view";

describe("dashboard query failure vs empty success", () => {
  it("throws on HTTP/PostgREST error instead of returning zeros", () => {
    expect(() =>
      throwIfQueryFailed([
        { error: null },
        { error: { message: "infinite recursion detected in policy for relation family_members" } },
      ]),
    ).toThrow(/infinite recursion/i);
  });

  it("keeps a successful empty payload as legitimate zeros", () => {
    expect(() => throwIfQueryFailed([{ error: null }, { error: null }])).not.toThrow();
    expect(
      isLegitimateEmptyDashboard({ totalStudents: 0, activeContracts: 0, monthRevenue: 0 }),
    ).toBe(true);
    expect(
      resolveDashboardView({
        isLoading: false,
        isError: false,
        error: null,
        stats: { totalStudents: 0, activeContracts: 0, monthRevenue: 0 },
      }),
    ).toEqual({
      status: "ready",
      stats: { totalStudents: 0, activeContracts: 0, monthRevenue: 0 },
    });
  });

  it("maps HTTP error to an error view, not ready zeros", () => {
    const view = resolveDashboardView({
      isLoading: false,
      isError: true,
      error: new Error("Failed to fetch"),
      stats: { totalStudents: 0, activeContracts: 0, monthRevenue: 0 },
    });
    expect(view.status).toBe("error");
    if (view.status === "error") expect(view.message).toBe("Failed to fetch");
  });

  it("maps populated stats to ready", () => {
    const view = resolveDashboardView({
      isLoading: false,
      isError: false,
      error: null,
      stats: { totalStudents: 12, activeContracts: 3, monthRevenue: 1500 },
    });
    expect(view).toEqual({
      status: "ready",
      stats: { totalStudents: 12, activeContracts: 3, monthRevenue: 1500 },
    });
    expect(
      isLegitimateEmptyDashboard({ totalStudents: 12, activeContracts: 3, monthRevenue: 1500 }),
    ).toBe(false);
  });
});

describe("relatorios student status empty state", () => {
  it("does not say Sem alunos cadastrados when only pending students exist", () => {
    const chart = buildStudentStatusChart({
      active: 0,
      inactive: 0,
      pending: 3,
      rejected: 0,
    });
    expect(chart.kind).toBe("chart");
    expect(chart.message).toMatch(/pendente/i);
    expect(chart.slices).toEqual([
      { name: "Pendentes", value: 3, color: "hsl(38, 92%, 50%)" },
    ]);
  });

  it("uses Sem alunos cadastrados only when the academy has zero students", () => {
    const chart = buildStudentStatusChart({
      active: 0,
      inactive: 0,
      pending: 0,
      rejected: 0,
    });
    expect(chart.kind).toBe("no-students");
    expect(chart.message).toBe("Sem alunos cadastrados.");
  });

  it("keeps rejected students out of the Pendentes slice", () => {
    const chart = buildStudentStatusChart({
      active: 2,
      inactive: 1,
      pending: 1,
      rejected: 1,
    });
    expect(chart.slices).toEqual([
      { name: "Ativos", value: 2, color: "hsl(142, 71%, 45%)" },
      { name: "Inativos", value: 1, color: "hsl(0, 0%, 40%)" },
      { name: "Pendentes", value: 1, color: "hsl(38, 92%, 50%)" },
      { name: "Rejeitados", value: 1, color: "hsl(0, 0%, 55%)" },
    ]);
  });
});

describe("dashboard error UI", () => {
  it("shows the error and retry, without fake zero indicators", () => {
    const onRetry = vi.fn();
    render(
      <QueryLoadError
        title="DASHBOARD"
        message="infinite recursion detected in policy for relation family_members"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("heading", { name: "DASHBOARD" })).toBeInTheDocument();
    expect(screen.getByText(/infinite recursion/i)).toBeInTheDocument();
    expect(screen.queryByText(/total de alunos/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
