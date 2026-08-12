import { describe, expect, it } from "vitest";
import type { PlanOption } from "@/lib/plans";
import {
  OFFICIAL_NEW_STUDENT_CATALOG,
  matchesOfficialNewStudentEntry,
  planCommercialAmount,
} from "@/lib/plans";
import {
  filterPlansForRegistrationAudience,
  groupNewStudentPlans,
  matchVeteranPlan,
  paymentMethodsForNewStudentPlan,
  requiresAdminPaymentConfirmation,
  validateVeteranTrainingDays,
  VETERAN_AWAITING_PRICE_MESSAGE,
} from "@/lib/registration-flows";

function catalogAsPlans(): PlanOption[] {
  return OFFICIAL_NEW_STUDENT_CATALOG.map((row, i) => ({
    id: `ns-${i}`,
    name: `${row.plan_kind} ${row.training_days_per_week}d`,
    audience: "new_student",
    plan_kind: row.plan_kind,
    training_days_per_week: row.training_days_per_week,
    duration_months: row.duration_months,
    billing_mode: row.billing_mode,
    monthly_price:
      row.billing_mode === "asaas_monthly"
        ? row.amount
        : Math.round((row.amount / row.duration_months) * 100) / 100,
    package_total_amount: row.billing_mode === "machine_prepaid" ? row.amount : null,
  }));
}

describe("official new_student catalog matrix", () => {
  it("maps all 16 combinations with official amounts and audience", () => {
    expect(OFFICIAL_NEW_STUDENT_CATALOG).toHaveLength(16);
    const plans = catalogAsPlans();
    for (const expected of OFFICIAL_NEW_STUDENT_CATALOG) {
      const hit = plans.find((p) => matchesOfficialNewStudentEntry(p, expected));
      expect(hit, `${expected.plan_kind} ${expected.training_days_per_week}d`).toBeTruthy();
      expect(planCommercialAmount(hit!)).toBe(expected.amount);
      expect(hit!.audience).toBe("new_student");
    }
  });

  it("never treats veteran plans as official new_student prices", () => {
    const veteranClone: PlanOption = {
      id: "v-bad",
      name: "fake",
      audience: "veterano",
      plan_kind: "mensal",
      training_days_per_week: 2,
      duration_months: 1,
      billing_mode: "asaas_monthly",
      monthly_price: 210,
    };
    expect(
      matchesOfficialNewStudentEntry(veteranClone, OFFICIAL_NEW_STUDENT_CATALOG[1]),
    ).toBe(false);
  });

  it("groups public catalog by modality and hides plans from veteran signup", () => {
    const plans = catalogAsPlans();
    const filtered = filterPlansForRegistrationAudience(plans, "new_student");
    expect(filtered).toHaveLength(16);
    expect(filterPlansForRegistrationAudience(plans, "veterano")).toEqual([]);
    const groups = groupNewStudentPlans(filtered);
    expect(groups.mensal).toHaveLength(4);
    expect(groups.trimestral).toHaveLength(4);
    expect(groups.semestral).toHaveLength(4);
    expect(groups.anual).toHaveLength(4);
    expect(groups.mensal.map((p) => p.training_days_per_week)).toEqual([1, 2, 3, 5]);
  });

  it("prepaid period payment excludes boleto; monthly offers only boleto XOR cartão", () => {
    const plans = catalogAsPlans();
    const monthly = plans.find((p) => p.plan_kind === "mensal")!;
    const trimestral = plans.find((p) => p.plan_kind === "trimestral")!;
    expect(paymentMethodsForNewStudentPlan(monthly)).toEqual(["boleto", "cartao_credito"]);
    expect(paymentMethodsForNewStudentPlan(trimestral)).not.toContain("boleto");
    expect(requiresAdminPaymentConfirmation("cartao_credito")).toBe(true);
  });

  it("veteran frequency accepts only 2/3/5 and never matches new_student prices", () => {
    expect(validateVeteranTrainingDays(1)).toBe(false);
    expect(validateVeteranTrainingDays(2)).toBe(true);
    expect(validateVeteranTrainingDays(4)).toBe(false);
    const plans = catalogAsPlans();
    expect(matchVeteranPlan({ plans, trainingDays: 2, period: "mensal" })).toBeNull();
    expect(VETERAN_AWAITING_PRICE_MESSAGE).toContain("ainda não configurados");
  });

  it("prepaid durations are 3/6/12 months", () => {
    for (const row of OFFICIAL_NEW_STUDENT_CATALOG.filter((p) => p.plan_kind !== "mensal")) {
      if (row.plan_kind === "trimestral") expect(row.duration_months).toBe(3);
      if (row.plan_kind === "semestral") expect(row.duration_months).toBe(6);
      if (row.plan_kind === "anual") expect(row.duration_months).toBe(12);
    }
  });
});
