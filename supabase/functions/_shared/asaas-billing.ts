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

export function isAsaasSandboxBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api-sandbox.asaas.com" || host === "sandbox.asaas.com";
  } catch {
    return false;
  }
}

/** Stable Asaas Idempotency-Key — same (student, month) must not create a second payment. */
export function buildAsaasPaymentIdempotencyKey(studentId: string, referenceMonth: string): string {
  return buildExternalReference(studentId, referenceMonth);
}

/** Page size for Asaas GET /payments — never treat limit=1 as uniqueness. */
export const ASAAS_PAYMENT_LOOKUP_PAGE_SIZE = 100;

export function buildAsaasPaymentsLookupPath(
  externalReference: string,
  offset = 0,
): string {
  return `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=${ASAAS_PAYMENT_LOOKUP_PAGE_SIZE}&offset=${offset}`;
}

export type AsaasPaymentListResponse = {
  data?: Array<Record<string, unknown>>;
  hasMore?: boolean;
};

const ASAAS_REUSABLE_PAYMENT_STATUSES = new Set([
  "PENDING",
  "OVERDUE",
  "CONFIRMED",
  "RECEIVED",
  "RECEIVED_IN_CASH",
  "AWAITING_RISK_ANALYSIS",
  "AWAITING_PAYMENT",
  "DUNNING_REQUESTED",
  "DUNNING_RECEIVED",
]);

function asaasPaymentStatus(payment: Record<string, unknown>): string {
  return String(payment.status ?? "").toUpperCase();
}

function isAsaasPaymentRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asaasPaymentListHasMore(
  response: AsaasPaymentListResponse,
  pageSize = ASAAS_PAYMENT_LOOKUP_PAGE_SIZE,
): boolean {
  if (response.hasMore === true) return true;
  return (response.data?.length ?? 0) >= pageSize;
}

/**
 * Pick one payment among every match for the same externalReference.
 * Prefer open/paid charges; deleted/refunded still count as existing so we do not POST again.
 */
export function pickExistingAsaasPayment(
  response: AsaasPaymentListResponse,
): Record<string, unknown> | null {
  const rows = (response.data ?? []).filter(isAsaasPaymentRow);
  if (rows.length === 0) return null;

  const reusable = rows.find((row) => ASAAS_REUSABLE_PAYMENT_STATUSES.has(asaasPaymentStatus(row)));
  if (reusable) return reusable;

  const notDeleted = rows.find((row) => {
    const status = asaasPaymentStatus(row);
    return status !== "DELETED" && status !== "REFUNDED";
  });
  if (notDeleted) return notDeleted;

  return rows[0];
}

export function shouldCreateAsaasPayment(existing: Record<string, unknown> | null): boolean {
  return existing === null;
}

/** Marker written on the local claim row before any Asaas create call. */
export const BILLING_GENERATION_CLAIM_MARKER = "generation_claim";

/** Another worker owns a claim without payment until this age (covers Asaas timeout + retry). */
export const BILLING_GENERATION_STALE_MS = 300_000;

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

  if (existing.status === "cancelado") {
    return { action: "already_exists", billingId: existing.id };
  }

  if (existing.status === "falhou") {
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
