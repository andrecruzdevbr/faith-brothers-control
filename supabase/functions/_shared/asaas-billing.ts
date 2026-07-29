import { extractAsaasErrorDetails, sanitizeBillingError } from "./tax-id.ts";

export type BillingProcessStage =
  | "ensure_customer"
  | "update_asaas_customer"
  | "find_existing_asaas_payment"
  | "create_asaas_payment"
  | "insert_local_billing"
  | "queue_whatsapp"
  | "resolve_student";

export type ProcessedBillingFailure = {
  studentId: string;
  studentName?: string;
  status: "failed";
  stage: BillingProcessStage;
  error: string;
  billingId?: string;
  asaasHttpStatus?: number;
  asaasDescription?: string;
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
  studentName?: string;
  stage: BillingProcessStage;
  error: unknown;
  billingId?: string;
}): ProcessedBillingFailure {
  const raw = params.error instanceof Error ? params.error.message : String(params.error);
  const message = sanitizeBillingError(raw);
  const asaas = extractAsaasErrorDetails(raw);
  return {
    studentId: params.studentId,
    ...(params.studentName ? { studentName: params.studentName } : {}),
    status: "failed",
    stage: params.stage,
    error: message,
    ...(params.billingId ? { billingId: params.billingId } : {}),
    ...(asaas.asaasHttpStatus != null ? { asaasHttpStatus: asaas.asaasHttpStatus } : {}),
    ...(asaas.asaasDescription ? { asaasDescription: asaas.asaasDescription } : {}),
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

/** PostgREST may return FK embeds as object or single-item array. */
export function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
