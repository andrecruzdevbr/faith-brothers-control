/** Pure finance indicators. Package/contract receipts are not multiplied per member. */

export const OPEN_BILLING_STATUSES = ["pendente", "gerado", "enviado_whatsapp"] as const;

export type BillingSnapshot = {
  studentId: string;
  status: string;
  dueDate: string;
  amount?: number;
  referenceMonth?: string | null;
};

export function deriveOverallStatus(
  billings: { status: string; due_date: string }[],
  today = new Date().toISOString().slice(0, 10),
) {
  if (billings.length === 0) return "sem_cobranca" as const;
  if (billings.some((b) => isDelinquentBilling({
    studentId: "",
    status: b.status,
    dueDate: b.due_date,
  }, today))) {
    return "atrasado" as const;
  }
  const latest = billings[0];
  if (latest.status === "pago") return "em_dia" as const;
  const days = Math.ceil((new Date(latest.due_date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86400000);
  if (days >= 0 && days <= 7) return "proximo" as const;
  if (OPEN_BILLING_STATUSES.includes(latest.status as (typeof OPEN_BILLING_STATUSES)[number])) {
    return "pendente" as const;
  }
  return "em_dia" as const;
}

export function isDelinquentBilling(billing: BillingSnapshot, today: string): boolean {
  if (billing.status === "pago" || billing.status === "cancelado") return false;
  if (billing.status === "vencido") return true;
  return (
    OPEN_BILLING_STATUSES.includes(billing.status as (typeof OPEN_BILLING_STATUSES)[number]) &&
    billing.dueDate < today
  );
}

export function countDelinquentStudents(rows: BillingSnapshot[], today: string): number {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isDelinquentBilling(row, today)) ids.add(row.studentId);
  }
  return ids.size;
}

export function isDueSoon(billing: BillingSnapshot, today: string, horizonDays = 7): boolean {
  if (!OPEN_BILLING_STATUSES.includes(billing.status as (typeof OPEN_BILLING_STATUSES)[number])) {
    return false;
  }
  if (billing.dueDate < today) return false;
  const horizon = new Date(today + "T12:00:00");
  horizon.setDate(horizon.getDate() + horizonDays);
  const horizonIso = horizon.toISOString().slice(0, 10);
  return billing.dueDate <= horizonIso;
}

export function addDaysIso(today: string, days: number): string {
  const date = new Date(today + "T12:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Paid Asaas billings plus one contract receipt.
 * A billing is omitted when that student-month is already covered by a prepaid contract,
 * so the package is counted once via contract_payments.
 */
export function sumReceipts(input: {
  billings: { studentId: string; referenceMonth: string; amount: number }[];
  coveredMonths: { studentId: string; referenceMonth: string }[];
  contractPayments: { amount: number }[];
}): number {
  const covered = new Set(
    input.coveredMonths.map((m) => `${m.studentId}|${m.referenceMonth.slice(0, 7)}`),
  );
  let total = 0;
  for (const billing of input.billings) {
    const key = `${billing.studentId}|${String(billing.referenceMonth).slice(0, 7)}`;
    if (covered.has(key)) continue;
    total += Number(billing.amount) || 0;
  }
  for (const payment of input.contractPayments) {
    total += Number(payment.amount) || 0;
  }
  return Math.round(total * 100) / 100;
}

export function buildMonthlyReceiptSeries(input: {
  billings: { studentId: string; referenceMonth: string; amount: number; status: string }[];
  coveredMonths: { studentId: string; referenceMonth: string }[];
  contractPayments: { amount: number; confirmedAt: string }[];
  months?: number;
  asOf?: Date;
}): { key: string; mes: string; valor: number }[] {
  const asOf = input.asOf ?? new Date();
  const count = input.months ?? 6;
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(asOf.getFullYear(), asOf.getMonth() - offset, 1);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    keys.push(`${date.getFullYear()}-${month}`);
  }
  return keys.map((key) => ({
    key,
    mes: new Date(`${key}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }),
    valor: sumReceipts({
      billings: input.billings.filter(
        (row) => row.status === "pago" && String(row.referenceMonth).slice(0, 7) === key,
      ),
      coveredMonths: input.coveredMonths.filter((row) => String(row.referenceMonth).slice(0, 7) === key),
      contractPayments: input.contractPayments.filter((row) => String(row.confirmedAt).slice(0, 7) === key),
    }),
  }));
}

export function isBillingUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /duplicate key|unique constraint/i.test(error.message ?? "");
}
