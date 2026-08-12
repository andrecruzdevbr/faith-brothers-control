/** Registration audience + payment channel rules (testable, no I/O). */

import type { PlanOption } from "@/lib/plans";
import {
  isMachineBillingMode,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";

export type RegistrationAudience = "new_student" | "veterano";

export type NewStudentPaymentChannel = "boleto" | PrepaidPaymentMethod;

/** Official veteran signup frequencies — no 1-day (price not provided). */
export const VETERAN_DAY_OPTIONS = [2, 3, 5] as const;
export type VeteranTrainingDays = (typeof VETERAN_DAY_OPTIONS)[number];

/** Official veteran monthly catalog (boleto; priced by frequency). */
export const OFFICIAL_VETERAN_MONTHLY_CATALOG = [
  { plan_kind: "mensal" as const, training_days_per_week: 2, monthly_price: 130, billing_mode: "asaas_monthly" as const },
  { plan_kind: "mensal" as const, training_days_per_week: 3, monthly_price: 150, billing_mode: "asaas_monthly" as const },
  { plan_kind: "mensal" as const, training_days_per_week: 5, monthly_price: 180, billing_mode: "asaas_monthly" as const },
];

/**
 * Official veteran prepaid fidelity catalog (cartão/maquininha).
 * Price is by modality only — frequency is independent (student.requested_training_days).
 * package_total = monthly_price × duration_months.
 */
export const OFFICIAL_VETERAN_PREPAID_CATALOG = [
  {
    plan_kind: "trimestral" as const,
    monthly_price: 160,
    duration_months: 3,
    package_total_amount: 480,
    billing_mode: "machine_prepaid" as const,
  },
  {
    plan_kind: "semestral" as const,
    monthly_price: 130,
    duration_months: 6,
    package_total_amount: 780,
    billing_mode: "machine_prepaid" as const,
  },
  {
    plan_kind: "anual" as const,
    monthly_price: 110,
    duration_months: 12,
    package_total_amount: 1320,
    billing_mode: "machine_prepaid" as const,
  },
] as const;

export function veteranPrepaidExpectedTotal(monthlyPrice: number, durationMonths: number): number {
  return Math.round(Number(monthlyPrice) * Number(durationMonths) * 100) / 100;
}

export function isVeteranPrepaidTotalValid(plan: {
  monthly_price?: number | null;
  reference_monthly_price?: number | null;
  package_total_amount?: number | null;
  duration_months?: number | null;
}): boolean {
  const months = Number(plan.duration_months ?? 0);
  const monthly = Number(plan.reference_monthly_price ?? plan.monthly_price ?? 0);
  const total = Number(plan.package_total_amount ?? 0);
  if (!(months > 0) || !(monthly > 0) || !(total > 0)) return false;
  return total === veteranPrepaidExpectedTotal(monthly, months);
}

/** ADM / student summary: monthly + contractual total for prepaid. */
export function formatVeteranPrepaidPriceSummary(plan: {
  monthly_price?: number | null;
  package_total_amount?: number | null;
  duration_months?: number | null;
}): string {
  const monthly = Number(plan.monthly_price ?? 0);
  const months = Number(plan.duration_months ?? 0);
  const total = Number(plan.package_total_amount ?? veteranPrepaidExpectedTotal(monthly, months));
  const fmt = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `${fmt(monthly)}/mês · ${months} meses · Total ${fmt(total)}`;
}

export type BillingPeriodChoice = "mensal" | "trimestral" | "semestral" | "anual";

export const BILLING_PERIOD_LABELS: Record<BillingPeriodChoice, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral (maquininha)",
  semestral: "Semestral (maquininha)",
  anual: "Anual (maquininha)",
};

/** Short modality title for accordion headers (no machine suffix). */
export function billingPeriodTitle(period: BillingPeriodChoice): string {
  return BILLING_PERIOD_LABELS[period].replace(" (maquininha)", "");
}

export const BILLING_PERIOD_ORDER: BillingPeriodChoice[] = [
  "mensal",
  "trimestral",
  "semestral",
  "anual",
];

export function formatTrainingDaysLabel(days: number | null | undefined): string {
  const n = Number(days ?? 0);
  if (n === 1) return "1 dia por semana";
  if (n > 0) return `${n} dias por semana`;
  return "Frequência não informada";
}

export function formatPlanDurationLabel(plan: PlanOption): string {
  const kind = resolvePlanKind(plan);
  const months = Number(plan.duration_months ?? 0);
  if (kind === "mensal" || months <= 1) return "1 mês";
  if (months > 0) return `${months} meses`;
  return "";
}

export type SelectedPlanSummary = {
  period: BillingPeriodChoice | "outro";
  periodTitle: string;
  daysLabel: string;
  amount: number;
  durationLabel: string;
  planId: string;
};

export function buildSelectedPlanSummary(plan: PlanOption | null | undefined): SelectedPlanSummary | null {
  if (!plan?.id) return null;
  const period = resolvePlanKind(plan);
  const amount =
    plan.billing_mode === "machine_prepaid"
      ? Number(plan.package_total_amount ?? plan.monthly_price ?? 0)
      : Number(plan.monthly_price ?? 0);
  return {
    period,
    periodTitle: period === "outro" ? "Plano" : billingPeriodTitle(period),
    daysLabel: formatTrainingDaysLabel(plan.training_days_per_week),
    amount,
    durationLabel: formatPlanDurationLabel(plan),
    planId: plan.id,
  };
}

/** Accordion sections present when catalog has plans for that modality. */
export function listOpenablePlanPeriods(
  groups: Record<BillingPeriodChoice, PlanOption[]>,
): BillingPeriodChoice[] {
  return BILLING_PERIOD_ORDER.filter((period) => (groups[period]?.length ?? 0) > 0);
}

export const NEW_STUDENT_PAYMENT_LABELS: Record<string, string> = {
  boleto: "Boleto",
  cartao_credito: "Cartão de crédito / maquininha",
  cartao_debito: "Cartão de débito (maquininha)",
  pix: "Pix (na academia)",
  dinheiro: "Dinheiro (na academia)",
};

/** Monthly (new_student + veteran): only boleto XOR card/machine. */
export const MONTHLY_PAYMENT_OPTIONS = ["boleto", "cartao_credito"] as const;
export type MonthlyPaymentOption = (typeof MONTHLY_PAYMENT_OPTIONS)[number];

export const MONTHLY_PAYMENT_LABELS: Record<MonthlyPaymentOption, string> = {
  boleto: "Boleto",
  cartao_credito: "Cartão de crédito / maquininha",
};

export const VETERAN_AWAITING_PRICE_MESSAGE =
  "Valores dos planos veteranos ainda não configurados.";

/** Card / machine channels never auto-mark payment as paid. */
export function isPhysicalMachinePaymentMethod(
  method?: string | null,
): method is PrepaidPaymentMethod {
  return (
    method === "cartao_credito" ||
    method === "cartao_debito" ||
    method === "pix" ||
    method === "dinheiro"
  );
}

export function requiresAdminPaymentConfirmation(method?: string | null): boolean {
  return isPhysicalMachinePaymentMethod(method);
}

export function isNewStudentPlanAudience(audience?: string | null): boolean {
  const a = (audience ?? "normal").toLowerCase();
  return a === "new_student" || a === "normal";
}

export function isVeteranPlanAudience(audience?: string | null): boolean {
  return (audience ?? "").toLowerCase() === "veterano";
}

export function resolvePlanKind(plan: PlanOption): BillingPeriodChoice | "outro" {
  const kind = (plan.plan_kind ?? "").toLowerCase();
  if (kind === "mensal" || kind === "trimestral" || kind === "semestral" || kind === "anual") {
    return kind;
  }
  const mode = plan.billing_mode ?? "asaas_monthly";
  const months = Number(plan.duration_months ?? 0);
  if (mode === "asaas_monthly" || months === 1) return "mensal";
  if (months === 3) return "trimestral";
  if (months === 6) return "semestral";
  if (months === 12) return "anual";
  return "outro";
}

export function isMonthlyPlan(plan: PlanOption): boolean {
  return resolvePlanKind(plan) === "mensal";
}

export function isPeriodPlan(plan: PlanOption): boolean {
  const kind = resolvePlanKind(plan);
  return kind === "trimestral" || kind === "semestral" || kind === "anual";
}

/** Public new-student catalog: never veteran. */
export function filterPlansForRegistrationAudience(
  plans: PlanOption[],
  audience: RegistrationAudience,
): PlanOption[] {
  if (audience === "new_student") {
    return plans.filter(
      (p) =>
        isNewStudentPlanAudience(p.audience) &&
        !isVeteranPlanAudience(p.audience) &&
        (isMonthlyPlan(p) || isPeriodPlan(p)),
    );
  }
  return [];
}

export function groupNewStudentPlans(plans: PlanOption[]): Record<
  BillingPeriodChoice,
  PlanOption[]
> {
  const groups: Record<BillingPeriodChoice, PlanOption[]> = {
    mensal: [],
    trimestral: [],
    semestral: [],
    anual: [],
  };
  for (const plan of plans) {
    const kind = resolvePlanKind(plan);
    if (kind === "outro") continue;
    groups[kind].push(plan);
  }
  for (const key of BILLING_PERIOD_ORDER) {
    groups[key].sort(
      (a, b) =>
        Number(a.training_days_per_week ?? 0) - Number(b.training_days_per_week ?? 0),
    );
  }
  return groups;
}

export function paymentMethodsForNewStudentPlan(plan: PlanOption | null | undefined): string[] {
  if (!plan) return [...MONTHLY_PAYMENT_OPTIONS];
  if (isMachineBillingMode(plan.billing_mode) || isPeriodPlan(plan)) {
    return ["cartao_credito", "cartao_debito", "pix", "dinheiro"];
  }
  // Mensal Asaas: only boleto XOR cartão/maquininha
  return [...MONTHLY_PAYMENT_OPTIONS];
}

export function paymentMethodsForVeteranMonthly(): MonthlyPaymentOption[] {
  return [...MONTHLY_PAYMENT_OPTIONS];
}

export function isMonthlyPaymentOption(method?: string | null): method is MonthlyPaymentOption {
  return method === "boleto" || method === "cartao_credito";
}

/** Card/machine never generates Asaas boleto (backend + cron must enforce). */
export function shouldSkipAsaasForPaymentMethod(method?: string | null): boolean {
  return isPhysicalMachinePaymentMethod(method);
}

export function validateVeteranTrainingDays(
  days: number | null | undefined,
): days is VeteranTrainingDays {
  return days === 2 || days === 3 || days === 5;
}

/** Periods the ADM can pick for a veteran given catalog rows with valid prices. */
export function listConfiguredVeteranPeriods(params: {
  plans: PlanOption[];
  trainingDays: number | null | undefined;
}): BillingPeriodChoice[] {
  if (!validateVeteranTrainingDays(params.trainingDays)) return [];
  return BILLING_PERIOD_ORDER.filter((period) =>
    Boolean(
      matchVeteranPlan({
        plans: params.plans,
        trainingDays: params.trainingDays,
        period,
      }),
    ),
  );
}

export function resolvePaymentReviewStatus(input: {
  paymentMethod?: string | null;
  billingMode?: string | null;
}): "aguardando_conferencia" | "nao_aplicavel" {
  if (requiresAdminPaymentConfirmation(input.paymentMethod)) {
    return "aguardando_conferencia";
  }
  if (isMachineBillingMode(input.billingMode)) {
    return "aguardando_conferencia";
  }
  return "nao_aplicavel";
}

export function planKindForBillingPeriod(period: BillingPeriodChoice): string {
  return period;
}

export function durationMonthsForBillingPeriod(period: BillingPeriodChoice): number {
  if (period === "mensal") return 1;
  if (period === "trimestral") return 3;
  if (period === "semestral") return 6;
  return 12;
}

/** True when a catalog row has a usable commercial amount (never invent). */
export function isPlanPriceConfigured(plan: PlanOption | null | undefined): boolean {
  if (!plan) return false;
  if (isMachineBillingMode(plan.billing_mode)) {
    const total = Number(plan.package_total_amount);
    return Number.isFinite(total) && total > 0;
  }
  const monthly = Number(plan.monthly_price);
  return Number.isFinite(monthly) && monthly > 0;
}

/**
 * Match ONLY audience=veterano plans. Never copy new_student prices.
 * Mensal: by frequency (2/3/5). Prepaid T/S/A: by modality only (days ignored).
 */
export function matchVeteranPlan(params: {
  plans: PlanOption[];
  trainingDays: VeteranTrainingDays;
  period: BillingPeriodChoice;
}): PlanOption | null {
  const { plans, trainingDays, period } = params;
  const duration = durationMonthsForBillingPeriod(period);
  const veteranPlans = plans.filter((p) => isVeteranPlanAudience(p.audience));

  if (period === "mensal") {
    const hit =
      veteranPlans.find(
        (p) =>
          (p.billing_mode ?? "asaas_monthly") === "asaas_monthly" &&
          Number(p.training_days_per_week) === trainingDays &&
          (isMonthlyPlan(p) || Number(p.duration_months ?? 1) === 1),
      ) ??
      veteranPlans.find(
        (p) =>
          Number(p.training_days_per_week) === trainingDays &&
          (p.plan_kind ?? "") === "mensal",
      ) ??
      null;
    return isPlanPriceConfigured(hit) ? hit : null;
  }

  const prepaidCandidates = veteranPlans.filter(
    (p) =>
      isMachineBillingMode(p.billing_mode) &&
      Number(p.duration_months ?? 0) === duration &&
      ((p.plan_kind ?? "") === period || Number(p.duration_months ?? 0) === duration) &&
      isPlanPriceConfigured(p) &&
      isVeteranPrepaidTotalValid(p),
  );

  // Prefer period-only SKUs (null days) over legacy day-matrix seeds.
  const hit =
    prepaidCandidates.find((p) => p.training_days_per_week == null) ??
    prepaidCandidates[0] ??
    null;

  return hit;
}

export function buildRegistrationReceivedIdempotencyKey(studentId: string): string {
  return `registration:${studentId}:received`;
}

export function buildRegistrationApprovedIdempotencyKey(studentId: string): string {
  return `registration:${studentId}:approved`;
}

export function buildVeteranPeriodRequestIdempotencyKey(studentId: string): string {
  return `registration:${studentId}:veteran_period_request`;
}

export function buildPaymentConfirmationIdempotencyKey(
  scope: string,
  entityId: string,
): string {
  return `payment_confirmation:${scope}:${entityId}`;
}
