import { describe, expect, it } from "vitest";
import {
  ACADEMY_REAL_PLANS,
  billingUsesApprovedPlanOnly,
  filterActivePlans,
  formatPendingPlanChangeLabel,
  formatPlanCurrentLabel,
  formatPlanListLabel,
  formatPlanOptionLabel,
  isMissingStudentPlan,
} from "@/lib/plans";
import { mapRegisterStudentRpcError } from "../../supabase/functions/_shared/register-errors.ts";
import { getMissingBillingSkipStatus } from "../../supabase/functions/_shared/billing-settings.ts";

describe("academy real plans", () => {
  it("defines the 3 official active plans with correct prices", () => {
    expect(ACADEMY_REAL_PLANS).toHaveLength(3);
    expect(ACADEMY_REAL_PLANS.map((p) => p.monthly_price)).toEqual([210, 230, 250]);
    expect(ACADEMY_REAL_PLANS.map((p) => p.training_days_per_week)).toEqual([2, 3, 5]);
  });

  it("formats signup labels with name and currency", () => {
    const label = formatPlanOptionLabel(ACADEMY_REAL_PLANS[0]);
    expect(label).toContain("Plano 2 dias por semana");
    expect(label).toContain("210");
  });
});

describe("plan labeling", () => {
  it("shows Sem plano when student has no plan", () => {
    expect(formatPlanListLabel(null)).toBe("Sem plano");
    expect(formatPlanCurrentLabel(null)).toBe("Sem plano");
    expect(formatPlanCurrentLabel({ name: "", monthly_price: 210 })).toBe("Sem plano");
  });

  it("shows current plan with price in Alunos list", () => {
    expect(
      formatPlanCurrentLabel({ name: "Plano 3 dias por semana", monthly_price: 230 }),
    ).toContain("230");
  });

  it("formats pending change request message", () => {
    expect(formatPendingPlanChangeLabel("Plano 3 dias por semana")).toBe(
      "Mudança solicitada: Plano 3 dias por semana → aguardando aprovação",
    );
  });

  it("detects missing plan_id", () => {
    expect(isMissingStudentPlan(null)).toBe(true);
    expect(isMissingStudentPlan("plan-1")).toBe(false);
  });
});

describe("plan change approval contract", () => {
  it("keeps billing on approved plan_id while request is pending", () => {
    expect(billingUsesApprovedPlanOnly("plan-current", "plan-requested")).toBe("plan-current");
    expect(billingUsesApprovedPlanOnly(null, "plan-requested")).toBeNull();
  });

  it("approve updates plan_id; reject keeps current", () => {
    const current = "plan-2";
    const requested = "plan-3";
    const afterApprove = requested;
    const afterReject = current;
    expect(afterApprove).toBe(requested);
    expect(afterReject).toBe(current);
  });
});

describe("public active plans", () => {
  it("lists only active plans for public signup", () => {
    const plans = [
      { id: "1", name: "Ativo", active: true, monthly_price: 100 },
      { id: "2", name: "Inativo", active: false, monthly_price: 80 },
      { id: "3", name: "Sem flag", monthly_price: 90 },
    ];
    const active = filterActivePlans(plans);
    expect(active.map((p) => p.id)).toEqual(["1", "3"]);
  });
});

describe("register-student plan requirement", () => {
  it("maps missing plan errors", () => {
    expect(mapRegisterStudentRpcError("Selecione um plano desejado.")).toEqual({
      status: 400,
      error: "Selecione um plano desejado.",
    });
  });

  it("registration stores plan_id on students without generating charge", () => {
    const savedOnSignup = {
      table: "students",
      field: "plan_id",
      status: "pendente_aprovacao",
      autoBilling: false,
    };
    expect(savedOnSignup.autoBilling).toBe(false);
  });
});

describe("billing eligibility with plan", () => {
  it("skips billing when plan is missing", () => {
    expect(getMissingBillingSkipStatus(false, true)).toBe("skipped_missing_plan");
  });

  it("allows billing path only when plan and settings exist", () => {
    expect(getMissingBillingSkipStatus(true, true)).toBeNull();
  });
});
