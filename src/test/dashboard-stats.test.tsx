import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryLoadError } from "@/components/QueryLoadError";
import {
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
