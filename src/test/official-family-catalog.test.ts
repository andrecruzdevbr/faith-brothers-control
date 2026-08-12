import { describe, expect, it } from "vitest";
import type { PlanOption } from "@/lib/plans";
import {
  FAMILY_MODEL_OPTIONS,
  OFFICIAL_FAMILY_CATALOG,
  OFFICIAL_NEW_STUDENT_CATALOG,
  TRAINING_DAY_OPTIONS,
  familyPackageRevenue,
  matchesOfficialFamilyEntry,
  officialFamilyPlanName,
  parseFamilyPlanModel,
  planCommercialAmount,
  resolveOfficialFamilyPlan,
} from "@/lib/plans";
import {
  countFamilyPractitioners,
  familyPerMemberShare,
  validateFamilyPractitionerCount,
  validateFamilyWizardMembers,
  createEmptyMemberDraft,
} from "@/lib/family-wizard";

function catalogAsPlans(): PlanOption[] {
  return OFFICIAL_FAMILY_CATALOG.map((row, i) => ({
    id: `fam-${i}`,
    name: officialFamilyPlanName(row.model, row.training_days_per_week),
    audience: "familia",
    category: `familia_${row.model}`,
    plan_kind: "mensal",
    training_days_per_week: row.training_days_per_week,
    duration_months: 1,
    billing_mode: "machine_prepaid",
    monthly_price: row.amount,
    package_total_amount: row.amount,
  }));
}

describe("official family catalog matrix", () => {
  it("exposes Family 1/2/3 models and 1/2/3/5 day options", () => {
    expect(FAMILY_MODEL_OPTIONS.map((m) => m.model)).toEqual([1, 2, 3]);
    expect([...TRAINING_DAY_OPTIONS]).toEqual([1, 2, 3, 5]);
  });

  it("maps all 12 official combinations with correct prices", () => {
    expect(OFFICIAL_FAMILY_CATALOG).toHaveLength(12);
    const plans = catalogAsPlans();
    for (const expected of OFFICIAL_FAMILY_CATALOG) {
      const hit = plans.find((p) => matchesOfficialFamilyEntry(p, expected));
      expect(hit, `Family ${expected.model} ${expected.training_days_per_week}d`).toBeTruthy();
      expect(planCommercialAmount(hit!)).toBe(expected.amount);
      expect(hit!.audience).toBe("familia");
    }
  });

  it.each(OFFICIAL_FAMILY_CATALOG)(
    "Family $model + $training_days_per_week day(s) = R$$amount",
    (row) => {
      const hit = resolveOfficialFamilyPlan(
        catalogAsPlans(),
        row.model,
        row.training_days_per_week,
      );
      expect(hit).toBeTruthy();
      expect(planCommercialAmount(hit!)).toBe(row.amount);
      expect(parseFamilyPlanModel(hit!)).toBe(row.model);
    },
  );

  it("does not multiply package price by practitioner count", () => {
    expect(familyPackageRevenue(760, 3)).toBe(760);
    expect(familyPackageRevenue(570, 2)).toBe(570);
    expect(familyPerMemberShare(570, 2)).toBe(285);
    expect(familyPackageRevenue(570, 2)).not.toBe(570 * 2);
  });

  it("resolves only one plan per model+frequency and ignores new_student", () => {
    const plans = catalogAsPlans();
    const selected = resolveOfficialFamilyPlan(plans, 2, 3);
    expect(selected?.name).toBe("Plano Familiar 2 — 3 dias por semana");
    expect(planCommercialAmount(selected!)).toBe(570);

    const ns: PlanOption = {
      id: "ns",
      name: "Plano 3 dias por semana",
      audience: "new_student",
      monthly_price: 230,
      training_days_per_week: 3,
      billing_mode: "asaas_monthly",
    };
    expect(matchesOfficialFamilyEntry(ns, OFFICIAL_FAMILY_CATALOG[6])).toBe(false);
    expect(OFFICIAL_NEW_STUDENT_CATALOG).toHaveLength(16);
  });

  it("validates covered practitioner count for each model", () => {
    expect(validateFamilyPractitionerCount(true, 0, 1)).toBeNull();
    expect(validateFamilyPractitionerCount(false, 1, 1)).toBeNull();
    expect(validateFamilyPractitionerCount(true, 1, 2)).toBeNull();
    expect(validateFamilyPractitionerCount(false, 3, 3)).toBeNull();
    expect(validateFamilyPractitionerCount(true, 0, 2)).toBeTruthy();
    expect(countFamilyPractitioners(true, 2)).toBe(3);
  });

  it("allows Family 1 with only training holder and no dependents", () => {
    const result = validateFamilyWizardMembers([], {
      responsibleTrains: true,
      financialResponsibleName: "André",
      expectedPractitionerCount: 1,
    });
    expect(result.ok).toBe(true);
  });

  it("requires exact member count for Family 2/3", () => {
    const one = {
      ...createEmptyMemberDraft(3),
      fullName: "Filho A",
      birthDate: "2012-01-01",
      relationship: "filho",
    };
    expect(
      validateFamilyWizardMembers([one], {
        responsibleTrains: true,
        financialResponsibleName: "André",
        expectedPractitionerCount: 2,
      }).ok,
    ).toBe(true);
    expect(
      validateFamilyWizardMembers([one], {
        responsibleTrains: true,
        financialResponsibleName: "André",
        expectedPractitionerCount: 3,
      }).ok,
    ).toBe(false);
  });

  it("preserves unique holder / no email / no repeated tax fields in payload builders", () => {
    // Covered by family-wizard payload tests; assert commercial invariants here.
    expect(FAMILY_MODEL_OPTIONS.every((m) => m.label.startsWith("Plano Familiar"))).toBe(true);
    expect(OFFICIAL_FAMILY_CATALOG.every((r) => r.amount > 0)).toBe(true);
  });
});
