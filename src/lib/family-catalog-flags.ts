/**
 * Commercial rule already implemented in get_public_active_plans:
 * official family catalog is machine_prepaid, so the public RPC only returns
 * audience=familia rows when BOTH flags are on.
 *
 * family_plans_enabled alone is not enough to contract.
 * prepaid_contracts_enabled is NOT turned on automatically here.
 */
export type PublicPlanFlags = {
  family_plans_enabled?: boolean | null;
  prepaid_contracts_enabled?: boolean | null;
};

export const PUBLIC_FAMILY_CATALOG_DISABLED_MESSAGE =
  "O Plano Familiar público usa o catálogo pré-pago. Esta academia ainda não liberou essa modalidade para contratação.";

export function isPublicFamilySignupEnabled(flags: PublicPlanFlags | null | undefined): boolean {
  return !!flags?.family_plans_enabled && !!flags?.prepaid_contracts_enabled;
}

export function familyCatalogSelectionMessage(input: {
  loading: boolean;
  catalogEnabled: boolean;
  plansCount: number;
  familyDays: number | null;
  hasSelectedPlan: boolean;
}): string | null {
  if (input.loading) return null;
  if (!input.catalogEnabled || input.plansCount === 0) {
    return PUBLIC_FAMILY_CATALOG_DISABLED_MESSAGE;
  }
  if (input.familyDays != null && !input.hasSelectedPlan) {
    return "Combinação indisponível no catálogo. Contate a academia.";
  }
  return null;
}
