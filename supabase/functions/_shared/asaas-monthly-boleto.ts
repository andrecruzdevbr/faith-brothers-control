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

export function shouldGenerateMonthlyBoleto(
  paymentMethod: string | null | undefined,
): boolean {
  const method = String(paymentMethod ?? "").trim().toLowerCase();
  if (!method || method === "boleto") return true;
  return !NON_BOLETO_PAYMENT_METHODS.has(method);
}

export function skipReasonForNonBoletoPaymentMethod(
  paymentMethod: string | null | undefined,
): "skipped_non_boleto_payment_method" | null {
  return shouldGenerateMonthlyBoleto(paymentMethod)
    ? null
    : "skipped_non_boleto_payment_method";
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
