/** ADM catalog editor: New Student and Veteran only. Never coerce familia. */

export type CatalogPlanRecord = {
  id: string;
  name: string;
  audience: string;
  plan_kind: string;
  training_days_per_week: number | null;
  monthly_price: number;
  package_total_amount: number | null;
  duration_months: number | null;
  billing_mode: string | null;
  allows_installments?: boolean | null;
  max_installments?: number | null;
  reference_monthly_price?: number | null;
  active: boolean;
};

export type CatalogEditorAudience = "new_student" | "veterano";
export type CatalogEditorPlanKind = "mensal" | "trimestral" | "semestral" | "anual";
export type CatalogEditorDays = "1" | "2" | "3" | "5";

export type CatalogEditorDraft = {
  name: string;
  audience: CatalogEditorAudience;
  plan_kind: CatalogEditorPlanKind;
  training_days_per_week: CatalogEditorDays;
  price: string;
  active: "true" | "false";
};

export const EMPTY_CATALOG_DRAFT: CatalogEditorDraft = {
  name: "",
  audience: "veterano",
  plan_kind: "mensal",
  training_days_per_week: "3",
  price: "",
  active: "false",
};

export const FAMILY_PLAN_EDIT_BLOCKED_MESSAGE =
  "Planos familiares oficiais não podem ser editados neste catálogo. Audience, billing_mode e valores pré-pagos são preservados.";

export const DROPIN_PLAN_EDIT_BLOCKED_MESSAGE =
  "Planos avulsos não podem ser editados neste catálogo.";

const EDITABLE_KINDS = new Set<string>(["mensal", "trimestral", "semestral", "anual"]);

export function mapAudienceForEditor(audience: string): CatalogEditorAudience | null {
  if (audience === "veterano") return "veterano";
  if (audience === "new_student") return "new_student";
  return null;
}

/** Documents the homolog bug: anything other than veterano became new_student. */
export function buggyCoerceAudienceToNewStudent(audience: string): CatalogEditorAudience {
  return audience === "veterano" ? "veterano" : "new_student";
}

export function catalogPlanEditBlockReason(plan: Pick<CatalogPlanRecord, "audience" | "plan_kind" | "billing_mode">): string | null {
  if (plan.audience === "familia") return FAMILY_PLAN_EDIT_BLOCKED_MESSAGE;
  if (mapAudienceForEditor(plan.audience) == null) {
    return `O público "${plan.audience}" não é suportado pelo editor.`;
  }
  if (!EDITABLE_KINDS.has(plan.plan_kind)) {
    return `O tipo "${plan.plan_kind}" não é suportado pelo editor.`;
  }
  if (plan.billing_mode === "machine_dropin") return DROPIN_PLAN_EDIT_BLOCKED_MESSAGE;
  return null;
}

export function catalogPlanDisplayAmount(plan: Pick<CatalogPlanRecord, "billing_mode" | "package_total_amount" | "monthly_price">): number {
  if (plan.billing_mode === "machine_prepaid" || plan.billing_mode === "machine_dropin") {
    return Number(plan.package_total_amount ?? plan.monthly_price);
  }
  return Number(plan.monthly_price);
}

export function billingDefaults(kind: CatalogEditorPlanKind): {
  billing_mode: string;
  duration_months: number;
  allows_installments: boolean;
} {
  if (kind === "mensal") {
    return { billing_mode: "asaas_monthly", duration_months: 1, allows_installments: false };
  }
  const duration = kind === "trimestral" ? 3 : kind === "semestral" ? 6 : 12;
  return { billing_mode: "machine_prepaid", duration_months: duration, allows_installments: true };
}

function parseEditorPrice(raw: string): number {
  return Number(String(raw).replace(",", "."));
}

export type CatalogPlanPayload = {
  academy_id: string;
  name: string;
  audience: string;
  plan_kind: string;
  training_days_per_week: number | null;
  duration_months: number | null;
  billing_mode: string | null;
  allows_installments: boolean;
  max_installments: number;
  active: boolean;
  monthly_price: number;
  reference_monthly_price: number;
  package_total_amount: number | null;
};

export type CatalogPlanWriteResult =
  | { ok: false; blocked: string }
  | { ok: true; payload: CatalogPlanPayload };

export function buildCatalogPlanWrite(input: {
  mode: "create" | "update";
  academyId: string;
  draft: CatalogEditorDraft;
  original?: CatalogPlanRecord | null;
}): CatalogPlanWriteResult {
  if (!input.draft.name.trim()) {
    return { ok: false, blocked: "Informe o nome do plano" };
  }
  const price = parseEditorPrice(input.draft.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, blocked: "Informe um valor válido" };
  }

  if (input.mode === "update") {
    if (!input.original) {
      return { ok: false, blocked: "Plano original não encontrado." };
    }
    const blocked = catalogPlanEditBlockReason(input.original);
    if (blocked) return { ok: false, blocked };

    const duration = Number(input.original.duration_months ?? 1) || 1;
    const billingMode = input.original.billing_mode ?? "asaas_monthly";
    const isMonthlyAsaas = billingMode === "asaas_monthly";
    const monthly = isMonthlyAsaas ? price : Math.round((price / duration) * 100) / 100;
    const allows = input.original.allows_installments ?? !isMonthlyAsaas;
    const maxInstallments =
      input.original.max_installments ?? (allows ? 12 : 1);

    return {
      ok: true,
      payload: {
        academy_id: input.academyId,
        name: input.draft.name.trim(),
        audience: input.original.audience,
        plan_kind: input.original.plan_kind,
        training_days_per_week: input.original.training_days_per_week,
        duration_months: input.original.duration_months,
        billing_mode: input.original.billing_mode,
        allows_installments: allows,
        max_installments: maxInstallments,
        active: input.draft.active === "true",
        monthly_price: monthly,
        reference_monthly_price: monthly,
        package_total_amount: isMonthlyAsaas ? input.original.package_total_amount : price,
      },
    };
  }

  const defaults = billingDefaults(input.draft.plan_kind);
  const days = Number(input.draft.training_days_per_week);
  const monthly =
    defaults.billing_mode === "asaas_monthly"
      ? price
      : Math.round((price / defaults.duration_months) * 100) / 100;

  return {
    ok: true,
    payload: {
      academy_id: input.academyId,
      name: input.draft.name.trim(),
      audience: input.draft.audience,
      plan_kind: input.draft.plan_kind,
      training_days_per_week: days,
      duration_months: defaults.duration_months,
      billing_mode: defaults.billing_mode,
      allows_installments: defaults.allows_installments,
      max_installments: defaults.allows_installments ? 12 : 1,
      active: input.draft.active === "true",
      monthly_price: monthly,
      reference_monthly_price: monthly,
      package_total_amount: defaults.billing_mode === "asaas_monthly" ? null : price,
    },
  };
}

export function draftFromCatalogPlan(plan: CatalogPlanRecord): CatalogEditorDraft | { blocked: string } {
  const blocked = catalogPlanEditBlockReason(plan);
  if (blocked) return { blocked };
  const audience = mapAudienceForEditor(plan.audience);
  if (!audience) return { blocked: FAMILY_PLAN_EDIT_BLOCKED_MESSAGE };
  const kind = EDITABLE_KINDS.has(plan.plan_kind)
    ? (plan.plan_kind as CatalogEditorPlanKind)
    : null;
  if (!kind) return { blocked: `O tipo "${plan.plan_kind}" não é suportado pelo editor.` };
  const days =
    plan.training_days_per_week === 1 ||
    plan.training_days_per_week === 2 ||
    plan.training_days_per_week === 3 ||
    plan.training_days_per_week === 5
      ? (String(plan.training_days_per_week) as CatalogEditorDays)
      : "3";
  return {
    name: plan.name,
    audience,
    plan_kind: kind,
    training_days_per_week: days,
    price: String(catalogPlanDisplayAmount(plan)),
    active: plan.active ? "true" : "false",
  };
}

export function audienceLabel(audience: string): string {
  if (audience === "familia") return "Familiar";
  if (audience === "veterano") return "Veterano";
  if (audience === "new_student") return "Novo aluno";
  return audience;
}
