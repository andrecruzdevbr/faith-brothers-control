/** Domain helpers for prepaid / family contracts (testable, no I/O). */

export type PrepaidPaymentMethod =
  | "cartao_credito"
  | "cartao_debito"
  | "pix"
  | "dinheiro";

export type PlanBillingMode = "asaas_monthly" | "machine_prepaid" | "machine_dropin";

export function toMonthStart(date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date}T12:00:00`) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function addMonths(monthStartIso: string, months: number): string {
  const d = new Date(`${monthStartIso}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return toMonthStart(d);
}

/** V1: first covered month is the civil month of startsOn (even mid-month). */
export function buildCoverageMonths(startsOn: string, durationMonths: number): string[] {
  if (!durationMonths || durationMonths <= 0) return [];
  const first = toMonthStart(startsOn);
  const out: string[] = [];
  for (let i = 0; i < durationMonths; i += 1) {
    out.push(addMonths(first, i));
  }
  return out;
}

/** Last inclusive calendar day of the last covered month. */
export function buildContractEndsOn(startsOn: string, durationMonths: number): string {
  if (!durationMonths || durationMonths <= 0) return startsOn;
  const first = toMonthStart(startsOn);
  const monthAfterLast = addMonths(first, durationMonths);
  const d = new Date(`${monthAfterLast}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveInstallments(input: {
  paymentMethod: PrepaidPaymentMethod;
  requestedInstallments?: number | null;
  allowsInstallments?: boolean | null;
  maxInstallments?: number | null;
}): { installments: number; error?: string } {
  const max = Math.max(1, Number(input.maxInstallments ?? 1));
  if (input.paymentMethod !== "cartao_credito") {
    return { installments: 1 };
  }
  if (!input.allowsInstallments) {
    return { installments: 1 };
  }
  const n = Number(input.requestedInstallments ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return { installments: 1, error: `Parcelas devem ser entre 1 e ${max}` };
  }
  return { installments: n };
}

export function estimatedInstallmentAmount(total: number, installments: number): number {
  const n = Math.max(1, installments);
  return Math.round((Number(total) / n) * 100) / 100;
}

export type PrepaidCronSkipReason =
  | "skipped_prepaid_month_covered"
  | "skipped_family_contract_covered"
  | "skipped_non_asaas_plan";

export function shouldSkipAsaasForPrepaidMonth(params: {
  billingMode?: PlanBillingMode | null;
  hasPaidCoverageForMonth: boolean;
  coverageSource?: "individual" | "family" | null;
}): { skip: boolean; reason?: PrepaidCronSkipReason } {
  if (params.hasPaidCoverageForMonth) {
    return {
      skip: true,
      reason:
        params.coverageSource === "family"
          ? "skipped_family_contract_covered"
          : "skipped_prepaid_month_covered",
    };
  }
  if (params.billingMode && params.billingMode !== "asaas_monthly") {
    return { skip: true, reason: "skipped_non_asaas_plan" };
  }
  return { skip: false };
}

export function familyCronSkipReason(hasFamilyCoverage: boolean): "skipped_family_contract_covered" | null {
  return hasFamilyCoverage ? "skipped_family_contract_covered" : null;
}

export function formatCoverageMonthLabel(referenceMonth: string): string {
  const d = new Date(`${toMonthStart(referenceMonth)}T12:00:00`);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

export function validateContractParty(input: {
  studentId?: string | null;
  familyGroupId?: string | null;
}): { ok: boolean; error?: string } {
  const hasStudent = Boolean(input.studentId);
  const hasFamily = Boolean(input.familyGroupId);
  if (hasStudent === hasFamily) {
    return {
      ok: false,
      error: "Contrato deve ser individual (student_id) OU familiar (family_group_id), nunca ambos.",
    };
  }
  return { ok: true };
}

export const PREPAID_PAYMENT_METHOD_LABELS: Record<PrepaidPaymentMethod, string> = {
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  pix: "Pix",
  dinheiro: "Dinheiro",
};

export function isMachineBillingMode(mode?: string | null): boolean {
  return mode === "machine_prepaid" || mode === "machine_dropin";
}

export function planDisplayTotal(plan: {
  billing_mode?: string | null;
  package_total_amount?: number | null;
  monthly_price?: number | null;
}): number {
  if (isMachineBillingMode(plan.billing_mode) && plan.package_total_amount != null) {
    return Number(plan.package_total_amount);
  }
  return Number(plan.monthly_price ?? 0);
}

export function maskTaxId(taxId?: string | null): string {
  const digits = String(taxId ?? "").replace(/\D/g, "");
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  if (digits.length >= 4) return `***${digits.slice(-2)}`;
  return "—";
}

export function needsPaymentReview(status?: string | null): boolean {
  return status === "aguardando_conferencia";
}

/** Pure domain check for family prepaid approval shape (pai + 2 filhos). */
export function buildFamilyApprovalSnapshot(input: {
  familyGroupId: string;
  memberStudentIds: string[];
  startsOn: string;
  durationMonths: number;
  paymentMethod: PrepaidPaymentMethod;
  installments: number;
  totalAmount: number;
}): {
  ok: boolean;
  error?: string;
  studentCount: number;
  contractCount: 1;
  paymentCount: 1;
  monthsPerStudent: string[];
  totalMonthRows: number;
} {
  const unique = [...new Set(input.memberStudentIds.filter(Boolean))];
  if (!input.familyGroupId) {
    return {
      ok: false,
      error: "family_group_id obrigatório",
      studentCount: 0,
      contractCount: 1,
      paymentCount: 1,
      monthsPerStudent: [],
      totalMonthRows: 0,
    };
  }
  if (unique.length < 1) {
    return {
      ok: false,
      error: "Informe ao menos um integrante",
      studentCount: 0,
      contractCount: 1,
      paymentCount: 1,
      monthsPerStudent: [],
      totalMonthRows: 0,
    };
  }
  const party = validateContractParty({ familyGroupId: input.familyGroupId });
  if (!party.ok) {
    return {
      ok: false,
      error: party.error,
      studentCount: unique.length,
      contractCount: 1,
      paymentCount: 1,
      monthsPerStudent: [],
      totalMonthRows: 0,
    };
  }
  const months = buildCoverageMonths(input.startsOn, input.durationMonths);
  const installments = resolveInstallments({
    paymentMethod: input.paymentMethod,
    requestedInstallments: input.installments,
    allowsInstallments: input.paymentMethod === "cartao_credito",
    maxInstallments: 24,
  });
  if (installments.error) {
    return {
      ok: false,
      error: installments.error,
      studentCount: unique.length,
      contractCount: 1,
      paymentCount: 1,
      monthsPerStudent: months,
      totalMonthRows: months.length * unique.length,
    };
  }
  return {
    ok: true,
    studentCount: unique.length,
    contractCount: 1,
    paymentCount: 1,
    monthsPerStudent: months,
    totalMonthRows: months.length * unique.length,
  };
}

export function todayIsoDateSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
