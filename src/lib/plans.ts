export type PlanOption = {
  id: string;
  name: string;
  monthly_price: number;
  training_days_per_week?: number | null;
};

export type PendingPlanChange = {
  id: string;
  student_id: string;
  current_plan_id: string | null;
  requested_plan_id: string;
  requested_plan_name?: string | null;
  requested_plan_price?: number | null;
};

export const ACADEMY_REAL_PLANS = [
  { name: "Plano 2 dias por semana", monthly_price: 210, training_days_per_week: 2 },
  { name: "Plano 3 dias por semana", monthly_price: 230, training_days_per_week: 3 },
  { name: "Plano 5 dias por semana", monthly_price: 250, training_days_per_week: 5 },
] as const;

export function formatPlanOptionLabel(plan: {
  name: string;
  monthly_price: number;
}): string {
  const price = Number(plan.monthly_price);
  const formatted = Number.isFinite(price)
    ? price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "R$ —";
  return `${plan.name} — ${formatted}`;
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
