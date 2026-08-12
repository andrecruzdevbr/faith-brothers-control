import { describe, expect, it } from "vitest";
import type { PlanOption } from "@/lib/plans";
import {
  OFFICIAL_VETERAN_MONTHLY_CATALOG,
  OFFICIAL_VETERAN_PREPAID_CATALOG,
  VETERAN_DAY_OPTIONS,
  filterPlansForRegistrationAudience,
  formatVeteranPrepaidPriceSummary,
  isVeteranPrepaidTotalValid,
  listConfiguredVeteranPeriods,
  matchVeteranPlan,
  validateVeteranTrainingDays,
  veteranPrepaidExpectedTotal,
} from "@/lib/registration-flows";
import { OFFICIAL_NEW_STUDENT_CATALOG, planCommercialAmount } from "@/lib/plans";
import { buildStudentPlanSituationView, expectedCoverageCount } from "@/lib/student-plan-situation";
import { buildCoverageMonths } from "@/lib/prepaid-contracts";

function officialVeteranCatalogAsPlans(): PlanOption[] {
  const monthly = OFFICIAL_VETERAN_MONTHLY_CATALOG.map((row) => ({
    id: `vm-${row.training_days_per_week}`,
    name: `Veterano Mensal — ${row.training_days_per_week} dias`,
    audience: "veterano",
    plan_kind: row.plan_kind,
    training_days_per_week: row.training_days_per_week,
    duration_months: 1,
    billing_mode: row.billing_mode,
    monthly_price: row.monthly_price,
    package_total_amount: null,
  }));
  const prepaid = OFFICIAL_VETERAN_PREPAID_CATALOG.map((row) => ({
    id: `vp-${row.plan_kind}`,
    name: `Veterano ${row.plan_kind}`,
    audience: "veterano",
    plan_kind: row.plan_kind,
    training_days_per_week: null,
    duration_months: row.duration_months,
    billing_mode: row.billing_mode,
    monthly_price: row.monthly_price,
    reference_monthly_price: row.monthly_price,
    package_total_amount: row.package_total_amount,
  }));
  return [...monthly, ...prepaid];
}

function newStudentAsPlans(): PlanOption[] {
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

describe("official veteran catalog", () => {
  it("maps mensal 2/3/5 to R$130 / R$150 / R$180 boleto", () => {
    expect(OFFICIAL_VETERAN_MONTHLY_CATALOG.map((r) => r.monthly_price)).toEqual([130, 150, 180]);
    const plans = officialVeteranCatalogAsPlans();
    expect(matchVeteranPlan({ plans, trainingDays: 2, period: "mensal" })?.monthly_price).toBe(130);
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "mensal" })?.monthly_price).toBe(150);
    expect(matchVeteranPlan({ plans, trainingDays: 5, period: "mensal" })?.monthly_price).toBe(180);
    expect(matchVeteranPlan({ plans, trainingDays: 2, period: "mensal" })?.billing_mode).toBe(
      "asaas_monthly",
    );
  });

  it("prepaid fidelity: 160×3=480, 130×6=780, 110×12=1320", () => {
    expect(veteranPrepaidExpectedTotal(160, 3)).toBe(480);
    expect(veteranPrepaidExpectedTotal(130, 6)).toBe(780);
    expect(veteranPrepaidExpectedTotal(110, 12)).toBe(1320);
    for (const row of OFFICIAL_VETERAN_PREPAID_CATALOG) {
      expect(row.package_total_amount).toBe(
        veteranPrepaidExpectedTotal(row.monthly_price, row.duration_months),
      );
      expect(isVeteranPrepaidTotalValid(row)).toBe(true);
    }
    const plans = officialVeteranCatalogAsPlans();
    const t = matchVeteranPlan({ plans, trainingDays: 2, period: "trimestral" })!;
    const s = matchVeteranPlan({ plans, trainingDays: 5, period: "semestral" })!;
    const a = matchVeteranPlan({ plans, trainingDays: 3, period: "anual" })!;
    expect(t.monthly_price).toBe(160);
    expect(t.package_total_amount).toBe(480);
    expect(t.duration_months).toBe(3);
    expect(s.monthly_price).toBe(130);
    expect(s.package_total_amount).toBe(780);
    expect(s.duration_months).toBe(6);
    expect(a.monthly_price).toBe(110);
    expect(a.package_total_amount).toBe(1320);
    expect(a.duration_months).toBe(12);
    expect(formatVeteranPrepaidPriceSummary(s)).toContain("780");
  });

  it("frequency is independent for prepaid — same plan for 2/3/5", () => {
    const plans = officialVeteranCatalogAsPlans();
    const ids = [2, 3, 5].map(
      (d) => matchVeteranPlan({ plans, trainingDays: d as 2 | 3 | 5, period: "trimestral" })?.id,
    );
    expect(ids).toEqual(["vp-trimestral", "vp-trimestral", "vp-trimestral"]);
    expect(VETERAN_DAY_OPTIONS).toEqual([2, 3, 5]);
    expect(validateVeteranTrainingDays(1)).toBe(false);
  });

  it("rejects invalid prepaid totals and never uses new_student prices", () => {
    const plans = [
      ...officialVeteranCatalogAsPlans(),
      ...newStudentAsPlans(),
      {
        id: "bad",
        name: "bad total",
        audience: "veterano",
        plan_kind: "trimestral",
        training_days_per_week: null,
        duration_months: 3,
        billing_mode: "machine_prepaid",
        monthly_price: 160,
        package_total_amount: 999,
      } as PlanOption,
    ];
    expect(matchVeteranPlan({ plans, trainingDays: 3, period: "trimestral" })?.id).toBe(
      "vp-trimestral",
    );
    expect(matchVeteranPlan({ plans, trainingDays: 2, period: "mensal" })?.monthly_price).not.toBe(
      210,
    );
    const ns2 = OFFICIAL_NEW_STUDENT_CATALOG.find(
      (r) => r.plan_kind === "mensal" && r.training_days_per_week === 2,
    )!;
    expect(planCommercialAmount({
      id: "x",
      name: "ns",
      monthly_price: ns2.amount,
      billing_mode: "asaas_monthly",
    })).toBe(210);
  });

  it("ADM sees all four official periods when catalog is loaded", () => {
    const plans = officialVeteranCatalogAsPlans();
    expect(listConfiguredVeteranPeriods({ plans, trainingDays: 3 })).toEqual([
      "mensal",
      "trimestral",
      "semestral",
      "anual",
    ]);
    expect(filterPlansForRegistrationAudience(plans, "veterano")).toEqual([]);
  });

  it("student view shows monthly + total + coverage for veteran semestral", () => {
    const refs = buildCoverageMonths("2026-08-15", 6);
    expect(expectedCoverageCount(6)).toBe(6);
    const view = buildStudentPlanSituationView({
      status: "ativo",
      approved_at: "2026-08-10T01:00:00Z",
      payment_review_status: "confirmado",
      registration_audience: "veterano",
      requested_training_days: 3,
      plan: {
        id: "vp-semestral",
        name: "Veterano Semestral",
        plan_kind: "semestral",
        training_days_per_week: null,
        billing_mode: "machine_prepaid",
        monthly_price: 130,
        package_total_amount: 780,
        duration_months: 6,
      },
      contract: {
        starts_on: "2026-08-15",
        ends_on: "2027-02-14",
        weekly_frequency: 3,
        total_amount: 780,
        payment_method: "cartao_credito",
        payment_status: "pago",
        contract_status: "ativo",
        duration_months: 6,
      },
      coverageMonths: refs.map((reference_month) => ({
        reference_month,
        status: "pago",
      })),
    });
    expect(view.planLabel).toBe("Veterano Semestral");
    expect(view.frequencyLabel).toContain("3 dias");
    expect(view.amountLabel).toBe("130.00");
    expect(view.amountSuffix).toBe("/mês");
    expect(view.totalAmountLabel).toBe("780.00");
    expect(view.coverage).toHaveLength(6);
    expect(view.coverageCountLabel).toBe("6 meses");
    expect(view.paymentMethodLabel?.toLowerCase()).toContain("cartão");
  });
});
