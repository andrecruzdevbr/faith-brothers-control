import { describe, expect, it } from "vitest";
import type { PlanOption } from "@/lib/plans";
import {
  filterPlansForRegistrationAudience,
  matchVeteranPlan,
  requiresAdminPaymentConfirmation,
  resolvePaymentReviewStatus,
  validateVeteranTrainingDays,
} from "@/lib/registration-flows";

const plans: PlanOption[] = [
  {
    id: "p2",
    name: "Plano 2 dias",
    monthly_price: 210,
    training_days_per_week: 2,
    audience: "new_student",
    billing_mode: "asaas_monthly",
    duration_months: 1,
  },
  {
    id: "p3",
    name: "Plano 3 dias",
    monthly_price: 230,
    training_days_per_week: 3,
    audience: "normal",
    billing_mode: "asaas_monthly",
    duration_months: 1,
  },
  {
    id: "vs3",
    name: "Semestral Veterano 3",
    monthly_price: 150,
    package_total_amount: 900,
    training_days_per_week: 3,
    audience: "veterano",
    billing_mode: "machine_prepaid",
    plan_kind: "semestral",
    duration_months: 6,
  },
  {
    id: "va3",
    name: "Anual Veterano 3",
    monthly_price: 150,
    package_total_amount: 1800,
    training_days_per_week: 3,
    audience: "veterano",
    billing_mode: "machine_prepaid",
    plan_kind: "anual",
    duration_months: 12,
  },
];

describe("registration payment rules", () => {
  it("never auto-approves card/machine methods", () => {
    expect(requiresAdminPaymentConfirmation("cartao_credito")).toBe(true);
    expect(requiresAdminPaymentConfirmation("boleto")).toBe(false);
    expect(resolvePaymentReviewStatus({ paymentMethod: "cartao_credito" })).toBe(
      "aguardando_conferencia",
    );
    expect(resolvePaymentReviewStatus({ paymentMethod: "boleto" })).toBe("nao_aplicavel");
  });

  it("filters new_student monthly plans only", () => {
    const filtered = filterPlansForRegistrationAudience(plans, "new_student");
    expect(filtered.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(filterPlansForRegistrationAudience(plans, "veterano")).toEqual([]);
  });

  it("validates veteran day choices and matches period plans", () => {
    expect(validateVeteranTrainingDays(3)).toBe(true);
    expect(validateVeteranTrainingDays(4)).toBe(false);
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "mensal" })?.id).toBe("p3");
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "semestral" })?.id).toBe("vs3");
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "anual" })?.id).toBe("va3");
  });
});
