import { sanitizeBillingError } from "./tax-id.ts";

export type BillingProcessStage =
  | "ensure_customer"
  | "update_asaas_customer"
  | "find_existing_asaas_payment"
  | "create_asaas_payment"
  | "insert_local_billing"
  | "queue_whatsapp";

export type ProcessedBillingFailure = {
  studentId: string;
  status: "failed";
  stage: BillingProcessStage;
  error: string;
  billingId?: string;
};

export function buildExternalReference(studentId: string, referenceMonth: string): string {
  return `${studentId}:${referenceMonth}`;
}

export function buildAsaasPaymentsLookupPath(externalReference: string): string {
  return `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=1`;
}

export type AsaasPaymentListResponse = {
  data?: Array<Record<string, unknown>>;
};

export function pickExistingAsaasPayment(
  response: AsaasPaymentListResponse,
): Record<string, unknown> | null {
  const first = response.data?.[0];
  if (!first || typeof first !== "object") return null;
  return first;
}

export function shouldCreateAsaasPayment(existing: Record<string, unknown> | null): boolean {
  return existing === null;
}

export function shouldUpdateAsaasCustomer(existingCpfCnpj: string, nextCpfCnpj: string): boolean {
  return !existingCpfCnpj || existingCpfCnpj !== nextCpfCnpj;
}

export function buildFailedProcessedEntry(params: {
  studentId: string;
  stage: BillingProcessStage;
  error: unknown;
  billingId?: string;
}): ProcessedBillingFailure {
  const raw = params.error instanceof Error ? params.error.message : String(params.error);
  const message = sanitizeBillingError(raw);
  return {
    studentId: params.studentId,
    status: "failed",
    stage: params.stage,
    error: message,
    ...(params.billingId ? { billingId: params.billingId } : {}),
  };
}

export function getAsaasPaymentFields(payment: Record<string, unknown>) {
  const id = typeof payment.id === "string" ? payment.id : null;
  const bankSlipUrl = typeof payment.bankSlipUrl === "string" ? payment.bankSlipUrl : null;
  const invoiceUrl = typeof payment.invoiceUrl === "string" ? payment.invoiceUrl : null;
  const invoiceNumber = typeof payment.invoiceNumber === "string" ? payment.invoiceNumber : null;
  return {
    id,
    bankSlipUrl,
    invoiceUrl,
    invoiceNumber,
    boletoUrl: bankSlipUrl ?? invoiceUrl,
  };
}
