import { getAsaasPaymentFields } from "./asaas-billing.ts";
import { DEFAULT_BOLETO_DUE_DAY, DEFAULT_BOLETO_ISSUE_DAY } from "./billing-settings.ts";

/** Asaas BOLETO fine: unique 2% after due date. */
export const BOLETO_FINE_PERCENT = 2;
/** Asaas BOLETO interest: 1% per month, proportional to days late. */
export const BOLETO_INTEREST_PERCENT_PER_MONTH = 1;
export const ASAAS_BOLETO_BILLING_TYPE = "BOLETO";
export const COMMERCIAL_MONTH_DAYS = 30;

export { DEFAULT_BOLETO_ISSUE_DAY, DEFAULT_BOLETO_DUE_DAY };

const NON_BOLETO_PAYMENT_METHODS = new Set([
  "cartao_credito",
  "cartao_debito",
  "pix",
  "dinheiro",
]);

/** Automatic monthly boleto requires an explicit boleto choice at signup. */
export function shouldGenerateMonthlyBoleto(
  paymentMethod: string | null | undefined,
): boolean {
  return String(paymentMethod ?? "").trim().toLowerCase() === "boleto";
}

export function skipReasonForNonBoletoPaymentMethod(
  paymentMethod: string | null | undefined,
): "skipped_non_boleto_payment_method" | null {
  return shouldGenerateMonthlyBoleto(paymentMethod)
    ? null
    : "skipped_non_boleto_payment_method";
}

export type AutomaticBoletoGateInput = {
  status?: string | null;
  requestedPaymentMethod?: string | null;
  billingMode?: string | null;
  paymentReviewStatus?: string | null;
  monthlyPrice?: number | null;
};

export type AutomaticBoletoGate =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "skipped_inactive_or_pending"
        | "skipped_non_boleto_payment_method"
        | "skipped_non_asaas_plan"
        | "skipped_zero_or_exempt_amount"
        | "skipped_payment_review_pending";
    };

/**
 * Cadastro → boleto → aprovação → aluno ativo → geração mensal.
 * Family/prepaid plans (billing_mode !== asaas_monthly) never enter this gate.
 */
export function evaluateAutomaticMonthlyBoleto(
  input: AutomaticBoletoGateInput,
): AutomaticBoletoGate {
  const status = String(input.status ?? "").trim().toLowerCase();
  if (status !== "ativo") {
    return { eligible: false, reason: "skipped_inactive_or_pending" };
  }

  const review = String(input.paymentReviewStatus ?? "").trim().toLowerCase();
  if (review && review !== "nao_aplicavel") {
    return { eligible: false, reason: "skipped_payment_review_pending" };
  }

  if (!shouldGenerateMonthlyBoleto(input.requestedPaymentMethod)) {
    return { eligible: false, reason: "skipped_non_boleto_payment_method" };
  }

  const billingMode = String(input.billingMode ?? "asaas_monthly").trim();
  if (billingMode !== "asaas_monthly") {
    return { eligible: false, reason: "skipped_non_asaas_plan" };
  }

  if (input.monthlyPrice != null && (!Number.isFinite(input.monthlyPrice) || input.monthlyPrice <= 0)) {
    return { eligible: false, reason: "skipped_zero_or_exempt_amount" };
  }

  return { eligible: true };
}

export type AsaasBoletoPaymentPayload = {
  customer: string;
  billingType: "BOLETO";
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
  fine: { value: number };
  interest: { value: number };
};

/**
 * Contractual due date stays on day 15. Asaas/banks apply the next-business-day
 * rule when that civil date is a weekend or holiday — we do not shift it here.
 */
export function buildAsaasBoletoPaymentPayload(params: {
  customerId: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
}): AsaasBoletoPaymentPayload {
  return {
    customer: params.customerId,
    billingType: ASAAS_BOLETO_BILLING_TYPE,
    value: params.value,
    dueDate: params.dueDate,
    description: params.description,
    externalReference: params.externalReference,
    fine: { value: BOLETO_FINE_PERCENT },
    interest: { value: BOLETO_INTEREST_PERCENT_PER_MONTH },
  };
}

export function preferBankSlipUrl(payment: Record<string, unknown>): string | null {
  return getAsaasPaymentFields(payment).boletoUrl;
}

export function civilDiffDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T12:00:00Z`);
  const to = Date.parse(`${toIso}T12:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export function isWeekendIsoDate(isoDate: string): boolean {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Local estimate of Asaas late charges. The academy finance ledger keeps the
 * original principal; Asaas applies fine/interest on the bank slip after due date.
 */
export function calculateBoletoLateCharges(params: {
  principal: number;
  dueDate: string;
  asOfDate: string;
}): {
  overdue: boolean;
  daysLate: number;
  fine: number;
  interest: number;
  total: number;
} {
  const daysLate = Math.max(0, civilDiffDays(params.dueDate, params.asOfDate));
  if (daysLate <= 0) {
    return {
      overdue: false,
      daysLate: 0,
      fine: 0,
      interest: 0,
      total: roundCents(params.principal),
    };
  }
  const fine = roundCents(params.principal * (BOLETO_FINE_PERCENT / 100));
  const interest = roundCents(
    params.principal * (BOLETO_INTEREST_PERCENT_PER_MONTH / 100) * (daysLate / COMMERCIAL_MONTH_DAYS),
  );
  return {
    overdue: true,
    daysLate,
    fine,
    interest,
    total: roundCents(params.principal + fine + interest),
  };
}

export function resolveMonthlyBillingWhatsAppRecipient(input: {
  studentId: string;
  studentWhatsapp: string;
  responsibleStudentId?: string | null;
  responsiblePhone?: string | null;
}): { recipient: string; source: "student" | "family_responsible" } {
  const responsiblePhone = String(input.responsiblePhone ?? "").trim();
  const responsibleDigits = responsiblePhone.replace(/\D/g, "");
  if (responsibleDigits.length >= 10) {
    return { recipient: responsiblePhone, source: "family_responsible" };
  }
  return { recipient: input.studentWhatsapp, source: "student" };
}

/**
 * Financial notices (boleto issued, overdue, payment confirmed) go to the
 * family responsible when one exists. Do not fall back to a dependent's phone.
 */
export function resolveFinancialNoticeRecipient(input: {
  studentId: string;
  studentWhatsapp: string;
  responsibleStudentId?: string | null;
  responsiblePhone?: string | null;
}): { recipient: string; source: "student" | "family_responsible" } {
  const resolved = resolveMonthlyBillingWhatsAppRecipient(input);
  if (resolved.source === "family_responsible") return resolved;
  if (input.responsibleStudentId) {
    return { recipient: "", source: "family_responsible" };
  }
  return resolved;
}

export function shouldDispatchBillingWhatsApp(params: {
  sendWhatsApp: boolean;
  asaasPaymentId: string | null | undefined;
}): boolean {
  return params.sendWhatsApp === true && Boolean(params.asaasPaymentId);
}

export function buildBillingIssuedIdempotencyKey(billingId: string): string {
  return `billing:${billingId}:issued`;
}

export function buildBillingOverdueReminderIdempotencyKey(billingId: string): string {
  return `billing:${billingId}:overdue_reminder`;
}

export function buildMonthlyBoletoWhatsAppMessage(params: {
  academyName: string;
  studentName: string;
  planName: string;
  amount: number;
  dueDate: string;
  bankSlipUrl: string;
  financeContact: string;
  financeWhatsapp: string;
}): string {
  const dueLabel = params.dueDate.split("-").reverse().join("/");
  return [
    params.academyName,
    "",
    `Olá ${params.studentName}!`,
    "",
    "Sua mensalidade foi gerada.",
    `Plano: ${params.planName}`,
    `Valor: R$ ${params.amount.toFixed(2).replace(".", ",")}`,
    `Vencimento: ${dueLabel}`,
    `Boleto: ${params.bankSlipUrl}`,
    "",
    `Dúvidas: ${params.financeContact} - ${params.financeWhatsapp}`,
    "OSS!",
  ].join("\n");
}
