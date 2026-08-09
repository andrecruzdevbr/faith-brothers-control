/** Registration audience + payment channel rules (testable, no I/O). */

import type { PlanOption } from "@/lib/plans";
import { TRAINING_DAY_OPTIONS, type TrainingDayOption } from "@/lib/plans";
import {
  isMachineBillingMode,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";

export type RegistrationAudience = "new_student" | "veterano";

export type NewStudentPaymentChannel = "boleto" | PrepaidPaymentMethod;

export const VETERAN_DAY_OPTIONS = TRAINING_DAY_OPTIONS;
export type VeteranTrainingDays = TrainingDayOption;

export type BillingPeriodChoice = "mensal" | "trimestral" | "semestral" | "anual";

export const BILLING_PERIOD_LABELS: Record<BillingPeriodChoice, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral (maquininha)",
  semestral: "Semestral (maquininha)",
  anual: "Anual (maquininha)",
};

export const BILLING_PERIOD_ORDER: BillingPeriodChoice[] = [
  "mensal",
  "trimestral",
  "semestral",
  "anual",
];

export const NEW_STUDENT_PAYMENT_LABELS: Record<string, string> = {
  boleto: "Mensal / Boleto (Asaas)",
  cartao_credito: "Cartão de crédito (maquininha)",
  cartao_debito: "Cartão de débito (maquininha)",
  pix: "Pix (na academia)",
  dinheiro: "Dinheiro (na academia)",
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
  if (!plan) return Object.keys(NEW_STUDENT_PAYMENT_LABELS);
  if (isMachineBillingMode(plan.billing_mode) || isPeriodPlan(plan)) {
    return ["cartao_credito", "cartao_debito", "pix", "dinheiro"];
  }
  return Object.keys(NEW_STUDENT_PAYMENT_LABELS);
}

export function validateVeteranTrainingDays(
  days: number | null | undefined,
): days is VeteranTrainingDays {
  return days === 1 || days === 2 || days === 3 || days === 5;
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

  const hit =
    veteranPlans.find(
      (p) =>
        isMachineBillingMode(p.billing_mode) &&
        Number(p.training_days_per_week) === trainingDays &&
        Number(p.duration_months ?? 0) === duration,
    ) ??
    veteranPlans.find(
      (p) =>
        isMachineBillingMode(p.billing_mode) &&
        Number(p.training_days_per_week) === trainingDays &&
        (p.plan_kind ?? "") === period,
    ) ??
    null;

  return isPlanPriceConfigured(hit) ? hit : null;
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
