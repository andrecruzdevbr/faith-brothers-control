import { describe, expect, it } from "vitest";
import type { PlanOption } from "@/lib/plans";
import {
  filterPlansForRegistrationAudience,
  groupNewStudentPlans,
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
    plan_kind: "mensal",
    duration_months: 1,
  },
  {
    id: "p3",
    name: "Plano 3 dias",
    monthly_price: 230,
    training_days_per_week: 3,
    audience: "normal",
    billing_mode: "asaas_monthly",
    plan_kind: "mensal",
    duration_months: 1,
  },
  {
    id: "nt3",
    name: "Trimestral Novo 3",
    monthly_price: 210,
    package_total_amount: 630,
    training_days_per_week: 3,
    audience: "new_student",
    billing_mode: "machine_prepaid",
    plan_kind: "trimestral",
    duration_months: 3,
  },
  {
    id: "vs",
    name: "Veterano Semestral",
    monthly_price: 130,
    package_total_amount: 780,
    training_days_per_week: null,
    audience: "veterano",
    billing_mode: "machine_prepaid",
    plan_kind: "semestral",
    duration_months: 6,
  },
  {
    id: "va",
    name: "Veterano Anual",
    monthly_price: 110,
    package_total_amount: 1320,
    training_days_per_week: null,
    audience: "veterano",
    billing_mode: "machine_prepaid",
    plan_kind: "anual",
    duration_months: 12,
  },
  {
    id: "vt",
    name: "Veterano Trimestral",
    monthly_price: 160,
    package_total_amount: 480,
    training_days_per_week: null,
    audience: "veterano",
    billing_mode: "machine_prepaid",
    plan_kind: "trimestral",
    duration_months: 3,
  },
  {
    id: "vm3",
    name: "Mensal Veterano 3",
    monthly_price: 150,
    training_days_per_week: 3,
    audience: "veterano",
    billing_mode: "asaas_monthly",
    plan_kind: "mensal",
    duration_months: 1,
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

  it("filters new_student plans and groups by modality; veteran signup gets none", () => {
    const filtered = filterPlansForRegistrationAudience(plans, "new_student");
    expect(filtered.map((p) => p.id).sort()).toEqual(["nt3", "p2", "p3"].sort());
    expect(filterPlansForRegistrationAudience(plans, "veterano")).toEqual([]);
    const groups = groupNewStudentPlans(filtered);
    expect(groups.mensal.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(groups.trimestral.map((p) => p.id)).toEqual(["nt3"]);
  });

  it("validates veteran day choices and matches prepaid by modality only", () => {
    expect(validateVeteranTrainingDays(1)).toBe(false);
    expect(validateVeteranTrainingDays(2)).toBe(true);
    expect(validateVeteranTrainingDays(3)).toBe(true);
    expect(validateVeteranTrainingDays(4)).toBe(false);
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "mensal" })?.id).toBe("vm3");
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "mensal" })?.id).not.toBe("p3");
    expect(matchVeteranPlan({ plans, trainingDays: 2, period: "semestral" })?.id).toBe("vs");
    expect(matchVeteranPlan({ plans, trainingDays: 5, period: "anual" })?.id).toBe("va");
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "trimestral" })?.id).toBe("vt");
  });
});
