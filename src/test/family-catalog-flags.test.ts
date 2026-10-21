import { describe, expect, it } from "vitest";
import {
  PUBLIC_FAMILY_CATALOG_DISABLED_MESSAGE,
  familyCatalogSelectionMessage,
  isPublicFamilySignupEnabled,
} from "@/lib/family-catalog-flags";
import { OFFICIAL_FAMILY_CATALOG } from "@/lib/plans";

describe("public family catalog commercial flags", () => {
  it("requires both family_plans_enabled and prepaid_contracts_enabled", () => {
    expect(isPublicFamilySignupEnabled({ family_plans_enabled: true })).toBe(false);
    expect(isPublicFamilySignupEnabled({ prepaid_contracts_enabled: true })).toBe(false);
    expect(
      isPublicFamilySignupEnabled({
        family_plans_enabled: true,
        prepaid_contracts_enabled: false,
      }),
    ).toBe(false);
    expect(
      isPublicFamilySignupEnabled({
        family_plans_enabled: true,
        prepaid_contracts_enabled: true,
      }),
    ).toBe(true);
  });

  it("does not invent official family prices", () => {
    expect(OFFICIAL_FAMILY_CATALOG[0]).toEqual({
      model: 1,
      training_days_per_week: 1,
      amount: 320,
    });
  });

  it("explains disabled prepaid catalog instead of a fake missing combination", () => {
    expect(
      familyCatalogSelectionMessage({
        loading: false,
        catalogEnabled: false,
        plansCount: 0,
        familyDays: 1,
        hasSelectedPlan: false,
      }),
    ).toBe(PUBLIC_FAMILY_CATALOG_DISABLED_MESSAGE);
  });

  it("keeps combination-missing copy only when the public catalog is actually loaded", () => {
    expect(
      familyCatalogSelectionMessage({
        loading: false,
        catalogEnabled: true,
        plansCount: 12,
        familyDays: 1,
        hasSelectedPlan: false,
      }),
    ).toBe("Combinação indisponível no catálogo. Contate a academia.");
  });
});
