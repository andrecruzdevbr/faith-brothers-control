export type PlanOption = {
  id: string;
  name: string;
  monthly_price: number;
  training_days_per_week?: number | null;
  audience?: string | null;
  plan_kind?: string | null;
  duration_months?: number | null;
  reference_monthly_price?: number | null;
  package_total_amount?: number | null;
  billing_mode?: string | null;
  allows_installments?: boolean | null;
  max_installments?: number | null;
  description?: string | null;
};

export type PendingPlanChange = {
  id: string;
  student_id: string;
  current_plan_id: string | null;
  requested_plan_id: string;
  requested_plan_name?: string | null;
  requested_plan_price?: number | null;
};

export const TRAINING_DAY_OPTIONS = [1, 2, 3, 5] as const;
export type TrainingDayOption = (typeof TRAINING_DAY_OPTIONS)[number];

/** Official NEW_STUDENT commercial matrix (source of truth for tests; UI loads prices from DB). */
export const OFFICIAL_NEW_STUDENT_CATALOG = [
  { plan_kind: "mensal", training_days_per_week: 1, amount: 180, duration_months: 1, billing_mode: "asaas_monthly" },
  { plan_kind: "mensal", training_days_per_week: 2, amount: 210, duration_months: 1, billing_mode: "asaas_monthly" },
  { plan_kind: "mensal", training_days_per_week: 3, amount: 230, duration_months: 1, billing_mode: "asaas_monthly" },
  { plan_kind: "mensal", training_days_per_week: 5, amount: 250, duration_months: 1, billing_mode: "asaas_monthly" },
  { plan_kind: "trimestral", training_days_per_week: 1, amount: 480, duration_months: 3, billing_mode: "machine_prepaid" },
  { plan_kind: "trimestral", training_days_per_week: 2, amount: 540, duration_months: 3, billing_mode: "machine_prepaid" },
  { plan_kind: "trimestral", training_days_per_week: 3, amount: 630, duration_months: 3, billing_mode: "machine_prepaid" },
  { plan_kind: "trimestral", training_days_per_week: 5, amount: 690, duration_months: 3, billing_mode: "machine_prepaid" },
  { plan_kind: "semestral", training_days_per_week: 1, amount: 990, duration_months: 6, billing_mode: "machine_prepaid" },
  { plan_kind: "semestral", training_days_per_week: 2, amount: 1155, duration_months: 6, billing_mode: "machine_prepaid" },
  { plan_kind: "semestral", training_days_per_week: 3, amount: 1260, duration_months: 6, billing_mode: "machine_prepaid" },
  { plan_kind: "semestral", training_days_per_week: 5, amount: 1350, duration_months: 6, billing_mode: "machine_prepaid" },
  { plan_kind: "anual", training_days_per_week: 1, amount: 1980, duration_months: 12, billing_mode: "machine_prepaid" },
  { plan_kind: "anual", training_days_per_week: 2, amount: 2310, duration_months: 12, billing_mode: "machine_prepaid" },
  { plan_kind: "anual", training_days_per_week: 3, amount: 2500, duration_months: 12, billing_mode: "machine_prepaid" },
  { plan_kind: "anual", training_days_per_week: 5, amount: 2750, duration_months: 12, billing_mode: "machine_prepaid" },
] as const;

/** @deprecated Use OFFICIAL_NEW_STUDENT_CATALOG — kept for older monthly-only references. */
export const ACADEMY_REAL_PLANS = OFFICIAL_NEW_STUDENT_CATALOG.filter(
  (p) => p.plan_kind === "mensal",
).map((p) => ({
  name: `Plano ${p.training_days_per_week} ${p.training_days_per_week === 1 ? "dia" : "dias"} por semana`,
  monthly_price: p.amount,
  training_days_per_week: p.training_days_per_week,
}));

export function planCommercialAmount(plan: {
  monthly_price: number;
  package_total_amount?: number | null;
  billing_mode?: string | null;
}): number {
  const isPackage =
    plan.billing_mode === "machine_prepaid" || plan.billing_mode === "machine_dropin";
  if (isPackage && plan.package_total_amount != null) {
    return Number(plan.package_total_amount);
  }
  return Number(plan.monthly_price);
}

export function formatPlanOptionLabel(plan: {
  name: string;
  monthly_price: number;
  package_total_amount?: number | null;
  billing_mode?: string | null;
  duration_months?: number | null;
}): string {
  const amount = planCommercialAmount(plan);
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "R$ —";
  const suffix =
    plan.billing_mode === "machine_prepaid" && plan.duration_months && plan.duration_months > 0
      ? ` · ${plan.duration_months} meses`
      : plan.billing_mode === "machine_dropin" && plan.duration_months === 0
        ? " · avulso"
        : "";
  return `${plan.name} — ${formatted}${suffix}`;
}

export function formatPlanListLabel(
  planName: string | null | undefined,
): string {
  const name = (planName ?? "").trim();
  return name ? name : "Sem plano";
}

/** Plano atual na listagem: nome + valor, ou "Sem plano". */
export function formatPlanCurrentLabel(
  plan:
    | { name?: string | null; monthly_price?: number | null }
    | null
    | undefined,
): string {
  const name = (plan?.name ?? "").trim();
  if (!name) return "Sem plano";
  const price = plan?.monthly_price;
  if (price == null || !Number.isFinite(Number(price))) return name;
  return formatPlanOptionLabel({ name, monthly_price: Number(price) });
}

export function formatPendingPlanChangeLabel(
  requestedPlanName: string | null | undefined,
): string {
  const name = (requestedPlanName ?? "").trim() || "plano solicitado";
  return `Mudança solicitada: ${name} → aguardando aprovação`;
}

export function isMissingStudentPlan(planId: string | null | undefined): boolean {
  return !planId;
}

export function filterActivePlans<T extends { active?: boolean | null }>(plans: T[]): T[] {
  return plans.filter((p) => p.active !== false);
}

/** Billing must ignore pending change requests and use only students.plan_id. */
export function billingUsesApprovedPlanOnly(
  studentPlanId: string | null | undefined,
  pendingRequestPlanId: string | null | undefined,
): string | null {
  void pendingRequestPlanId;
  return studentPlanId ?? null;
}

export function matchesOfficialNewStudentEntry(
  plan: PlanOption,
  expected: (typeof OFFICIAL_NEW_STUDENT_CATALOG)[number],
): boolean {
  if ((plan.audience ?? "").toLowerCase() === "veterano") return false;
  const kind = (plan.plan_kind ?? "mensal").toLowerCase();
  if (kind !== expected.plan_kind) return false;
  if (Number(plan.training_days_per_week) !== expected.training_days_per_week) return false;
  if (Number(plan.duration_months ?? 1) !== expected.duration_months) return false;
  const amount = planCommercialAmount(plan);
  return Math.abs(amount - expected.amount) < 0.01;
}
