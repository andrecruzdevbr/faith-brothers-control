/** Registration audience + payment channel rules (testable, no I/O). */

import type { PlanOption } from "@/lib/plans";
import {
  isMachineBillingMode,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";

export type RegistrationAudience = "new_student" | "veterano";

export type NewStudentPaymentChannel = "boleto" | PrepaidPaymentMethod;

export const VETERAN_DAY_OPTIONS = [2, 3, 5] as const;
export type VeteranTrainingDays = (typeof VETERAN_DAY_OPTIONS)[number];

export type BillingPeriodChoice = "mensal" | "semestral" | "anual";

export const BILLING_PERIOD_LABELS: Record<BillingPeriodChoice, string> = {
  mensal: "Mensal (boleto)",
  semestral: "Semestral (maquininha)",
  anual: "Anual (maquininha)",
};

export const NEW_STUDENT_PAYMENT_LABELS: Record<string, string> = {
  boleto: "Mensal / Boleto",
  cartao_credito: "Cartão de crédito (maquininha)",
  cartao_debito: "Cartão de débito (maquininha)",
  pix: "Pix (na academia)",
  dinheiro: "Dinheiro (na academia)",
};

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

export function filterPlansForRegistrationAudience(
  plans: PlanOption[],
  audience: RegistrationAudience,
): PlanOption[] {
  if (audience === "new_student") {
    return plans.filter(
      (p) =>
        isNewStudentPlanAudience(p.audience) &&
        !isVeteranPlanAudience(p.audience) &&
        (p.billing_mode ?? "asaas_monthly") === "asaas_monthly",
    );
  }
  // Veterano chooses days only at signup — packages are assigned after period choice.
  return [];
}

export function validateVeteranTrainingDays(
  days: number | null | undefined,
): days is VeteranTrainingDays {
  return days === 2 || days === 3 || days === 5;
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
  if (period === "semestral") return 6;
  return 12;
}

export function matchVeteranPlan(params: {
  plans: PlanOption[];
  trainingDays: VeteranTrainingDays;
  period: BillingPeriodChoice;
}): PlanOption | null {
  const { plans, trainingDays, period } = params;
  if (period === "mensal") {
    return (
      plans.find(
        (p) =>
          isNewStudentPlanAudience(p.audience) &&
          (p.billing_mode ?? "asaas_monthly") === "asaas_monthly" &&
          Number(p.training_days_per_week) === trainingDays,
      ) ?? null
    );
  }
  const duration = durationMonthsForBillingPeriod(period);
  return (
    plans.find(
      (p) =>
        isVeteranPlanAudience(p.audience) &&
        isMachineBillingMode(p.billing_mode) &&
        Number(p.training_days_per_week) === trainingDays &&
        Number(p.duration_months ?? 0) === duration,
    ) ??
    plans.find(
      (p) =>
        isVeteranPlanAudience(p.audience) &&
        isMachineBillingMode(p.billing_mode) &&
        Number(p.training_days_per_week) === trainingDays &&
        (p.plan_kind ?? "") === period,
    ) ??
    null
  );
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
