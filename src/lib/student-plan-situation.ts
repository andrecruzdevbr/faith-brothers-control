/** Student-facing plan / financial situation (pure helpers, no I/O). */

import type { PlanOption } from "@/lib/plans";
import { resolvePlanKind, billingPeriodTitle, formatTrainingDaysLabel } from "@/lib/registration-flows";
import {
  PREPAID_PAYMENT_METHOD_LABELS,
  formatCoverageMonthLabel,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";

export type FriendlyPlanSituationStatus =
  | "Cadastro em análise"
  | "Cadastro aprovado — aguardando pagamento"
  | "Aguardando confirmação do pagamento"
  | "Aguardando definição do plano"
  | "Ativo"
  | "Aguardando pagamento"
  | "Pago"
  | "Pagamento vencido"
  | "Inativo"
  | "Rejeitado";

const TECHNICAL_STATUS_LEAKS = [
  "pendente_aprovacao",
  "machine_prepaid",
  "aguardando_conferencia",
  "payment_review",
  "asaas_monthly",
  "contract_payment",
] as const;

export function containsTechnicalStatusLeak(text: string): boolean {
  const lower = text.toLowerCase();
  return TECHNICAL_STATUS_LEAKS.some((t) => lower.includes(t));
}

export type CoverageMonthView = {
  referenceMonth: string;
  label: string;
  paid: boolean;
};

export type StudentPlanSituationInput = {
  status?: string | null;
  approved_at?: string | null;
  payment_review_status?: string | null;
  registration_audience?: string | null;
  requested_training_days?: number | null;
  requested_payment_method?: string | null;
  plan?: Partial<PlanOption> | null;
  contract?: {
    starts_on?: string | null;
    ends_on?: string | null;
    weekly_frequency?: number | null;
    total_amount?: number | null;
    payment_method?: string | null;
    payment_status?: string | null;
    contract_status?: string | null;
    duration_months?: number | null;
  } | null;
  coverageMonths?: Array<{ reference_month: string; status: string }>;
  latestBillingStatus?: string | null;
  isFamilyMember?: boolean;
  hideFinancialDetails?: boolean;
};

export type StudentPlanSituationView = {
  title: string;
  /** Cadastro: Aprovado / Em análise / … */
  registrationLabel: string;
  statusLabel: FriendlyPlanSituationStatus;
  statusMessage: string | null;
  planLabel: string;
  frequencyLabel: string;
  frequencyCaption: string;
  amountLabel: string | null;
  paymentMethodLabel: string | null;
  /** Financeiro / Pagamento line */
  paymentLabel: string | null;
  financialLabel: string | null;
  periodLabel: string | null;
  coverage: CoverageMonthView[];
  showCoverageAsPaid: boolean;
  /** When awaiting payment: show explicit empty months. */
  monthsEmptyLabel: string | null;
  isVeteranAwaitingPlan: boolean;
  isAwaitingPaymentConfirm: boolean;
};

function friendlyBillingStatus(status?: string | null): FriendlyPlanSituationStatus | null {
  if (!status) return null;
  if (status === "pago") return "Pago";
  if (status === "vencido") return "Pagamento vencido";
  if (["pendente", "gerado", "enviado_whatsapp"].includes(status)) return "Aguardando pagamento";
  return null;
}

/** Friendly label for Asaas billing rows shown to the student. */
export function friendlyBillingStatusLabel(status?: string | null): string {
  return friendlyBillingStatus(status) ?? "Em andamento";
}

export function resolveFriendlyPlanSituationStatus(
  input: StudentPlanSituationInput,
): FriendlyPlanSituationStatus {
  if (input.status === "rejeitado") return "Rejeitado";
  if (input.status === "inativo") return "Inativo";

  const isVeteran = input.registration_audience === "veterano";
  const hasPaidContract =
    input.contract?.payment_status === "pago" &&
    (input.coverageMonths ?? []).some((m) => m.status === "pago");

  if (hasPaidContract || (input.status === "ativo" && input.contract?.payment_status === "pago")) {
    return "Ativo";
  }

  if (isVeteran && !input.plan?.id && input.approved_at) {
    return "Aguardando definição do plano";
  }

  if (
    input.approved_at &&
    input.payment_review_status === "aguardando_conferencia" &&
    input.contract?.payment_status !== "pago"
  ) {
    return "Aguardando confirmação do pagamento";
  }

  if (input.status === "pendente_aprovacao" && !input.approved_at) {
    return "Cadastro em análise";
  }

  if (input.approved_at && input.status === "pendente_aprovacao") {
    return "Cadastro aprovado — aguardando pagamento";
  }

  const billing = friendlyBillingStatus(input.latestBillingStatus);
  if (billing) return billing;

  if (input.status === "ativo") return "Ativo";
  return "Cadastro em análise";
}

export function buildStudentPlanSituationView(
  input: StudentPlanSituationInput,
): StudentPlanSituationView {
  const statusLabel = resolveFriendlyPlanSituationStatus(input);
  const isVeteran = input.registration_audience === "veterano";
  const isVeteranAwaitingPlan = isVeteran && !input.plan?.id && Boolean(input.approved_at);
  const paid =
    input.contract?.payment_status === "pago" ||
    (input.coverageMonths ?? []).some((m) => m.status === "pago");
  const isAwaitingPaymentConfirm =
    Boolean(input.approved_at) &&
    input.payment_review_status === "aguardando_conferencia" &&
    !paid;

  const kind = input.plan ? resolvePlanKind(input.plan as PlanOption) : "outro";
  const days =
    input.contract?.weekly_frequency ??
    input.plan?.training_days_per_week ??
    input.requested_training_days ??
    null;

  let registrationLabel: string;
  if (input.status === "rejeitado") registrationLabel = "Rejeitado";
  else if (input.approved_at) registrationLabel = "Aprovado";
  else if (input.status === "pendente_aprovacao") registrationLabel = "Em análise";
  else if (input.status === "ativo") registrationLabel = "Aprovado";
  else registrationLabel = input.status ?? "—";

  let planLabel: string;
  if (isVeteranAwaitingPlan) {
    planLabel = "Aguardando definição";
  } else if (kind !== "outro") {
    planLabel = billingPeriodTitle(kind);
  } else if (input.plan?.name) {
    planLabel = String(input.plan.name);
  } else if (!input.approved_at) {
    planLabel = "Cadastro em análise";
  } else {
    planLabel = "Aguardando definição";
  }

  const frequencyCaption = isVeteranAwaitingPlan ? "Frequência solicitada" : "Frequência";
  const frequencyLabel = isVeteranAwaitingPlan
    ? formatTrainingDaysLabel(input.requested_training_days)
    : formatTrainingDaysLabel(days);

  let amountLabel: string | null = null;
  if (!isVeteranAwaitingPlan && !isAwaitingPaymentConfirm && !input.hideFinancialDetails && input.plan) {
    const amount =
      input.contract?.total_amount != null
        ? Number(input.contract.total_amount)
        : input.plan.billing_mode === "machine_prepaid"
          ? Number(input.plan.package_total_amount ?? input.plan.monthly_price ?? NaN)
          : Number(input.plan.monthly_price ?? NaN);
    if (Number.isFinite(amount) && amount > 0) {
      amountLabel = amount.toFixed(2);
    }
  }

  let paymentMethodLabel: string | null = null;
  if (isVeteranAwaitingPlan) {
    paymentMethodLabel = "Aguardando definição";
  } else if (!input.hideFinancialDetails && !isAwaitingPaymentConfirm) {
    const method = input.contract?.payment_method ?? input.requested_payment_method;
    if (method === "boleto") paymentMethodLabel = "Boleto (Asaas)";
    else if (method && method in PREPAID_PAYMENT_METHOD_LABELS) {
      paymentMethodLabel = PREPAID_PAYMENT_METHOD_LABELS[method as PrepaidPaymentMethod];
    } else if (method) paymentMethodLabel = method;
  }

  let paymentLabel: string | null = null;
  let financialLabel: string | null = null;
  if (paid) {
    paymentLabel = "Confirmado";
    financialLabel = "Confirmado";
  } else if (isAwaitingPaymentConfirm || statusLabel === "Aguardando confirmação do pagamento") {
    paymentLabel = "Aguardando confirmação do pagamento";
    financialLabel = "Aguardando confirmação do pagamento";
  } else if (isVeteranAwaitingPlan || statusLabel === "Aguardando definição do plano") {
    paymentLabel = "Aguardando definição";
    financialLabel = "Aguardando definição";
  } else if (statusLabel === "Cadastro em análise") {
    paymentLabel = null;
    financialLabel = null;
  } else if (statusLabel === "Aguardando pagamento") {
    paymentLabel = "Aguardando pagamento";
    financialLabel = "Aguardando pagamento";
  }

  const showCoverageAsPaid = paid;
  const coverage: CoverageMonthView[] = showCoverageAsPaid
    ? (input.coverageMonths ?? [])
        .filter((m) => m.status === "pago")
        .map((m) => ({
          referenceMonth: m.reference_month,
          label: formatCoverageMonthLabel(m.reference_month),
          paid: true,
        }))
    : [];

  const monthsEmptyLabel =
    !showCoverageAsPaid && (isAwaitingPaymentConfirm || (Boolean(input.approved_at) && !paid && !isVeteranAwaitingPlan))
      ? "Nenhum ainda"
      : null;

  let statusMessage: string | null = null;
  if (statusLabel === "Aguardando confirmação do pagamento") {
    statusMessage =
      "Seu cadastro foi aprovado. Estamos aguardando a confirmação do pagamento pela academia.";
  } else if (statusLabel === "Aguardando definição do plano") {
    statusMessage = "Sua frequência foi registrada. A academia definirá o plano e a forma de pagamento.";
  }

  const periodLabel =
    paid && input.contract?.starts_on && input.contract?.ends_on
      ? `${input.contract.starts_on} até ${input.contract.ends_on}`
      : null;

  return {
    title: "SITUAÇÃO DO PLANO",
    registrationLabel,
    statusLabel,
    statusMessage,
    planLabel,
    frequencyLabel,
    frequencyCaption,
    amountLabel,
    paymentMethodLabel,
    paymentLabel,
    financialLabel,
    periodLabel,
    coverage,
    showCoverageAsPaid,
    monthsEmptyLabel,
    isVeteranAwaitingPlan,
    isAwaitingPaymentConfirm,
  };
}

export function expectedCoverageCount(durationMonths: number | null | undefined): number {
  const n = Number(durationMonths ?? 0);
  return n > 0 ? n : 0;
}
