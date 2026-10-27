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

/** Stable Asaas Idempotency-Key — same (student, month) must not create a second payment. */
export function buildAsaasPaymentIdempotencyKey(studentId: string, referenceMonth: string): string {
  return buildExternalReference(studentId, referenceMonth);
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

/** Marker written on the local claim row before any Asaas create call. */
export const BILLING_GENERATION_CLAIM_MARKER = "generation_claim";

/** Another worker owns a claim without payment until this age. */
export const BILLING_GENERATION_STALE_MS = 120_000;

export type BillingGenerationSnapshot = {
  id: string;
  status: string;
  asaas_payment_id?: string | null;
  updated_at?: string | null;
  last_error?: string | null;
};

export type BillingGenerationDecision =
  | { action: "create_claim" }
  | { action: "complete_claimed"; billingId: string }
  | { action: "reprocess_failed"; billingId: string }
  | { action: "already_exists"; billingId: string }
  | { action: "in_progress"; billingId: string };

/**
 * Decide work for (student, month) BEFORE calling Asaas create.
 * Local UNIQUE claim must win first so concurrent workers cannot both POST payments.
 */
export function decideBillingGenerationAction(
  existing: BillingGenerationSnapshot | null,
  now = new Date(),
  staleMs = BILLING_GENERATION_STALE_MS,
): BillingGenerationDecision {
  if (!existing) return { action: "create_claim" };

  if (existing.status === "pago") {
    return { action: "already_exists", billingId: existing.id };
  }

  if (existing.asaas_payment_id) {
    return { action: "already_exists", billingId: existing.id };
  }

  if (existing.status === "cancelado" || existing.status === "falhou") {
    return { action: "reprocess_failed", billingId: existing.id };
  }

  const updatedAtMs = existing.updated_at ? Date.parse(existing.updated_at) : NaN;
  const ageMs = Number.isFinite(updatedAtMs) ? now.getTime() - updatedAtMs : Number.POSITIVE_INFINITY;
  const isClaim =
    existing.last_error === BILLING_GENERATION_CLAIM_MARKER || existing.status === "pendente";

  if (isClaim && ageMs < staleMs) {
    return { action: "in_progress", billingId: existing.id };
  }

  return { action: "complete_claimed", billingId: existing.id };
}

export function isBillingUniqueViolation(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(error.message ?? "");
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
