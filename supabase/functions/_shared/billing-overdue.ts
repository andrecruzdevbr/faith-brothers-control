import {
  formatDateLabelPt,
  formatMonthLabelPt,
  formatUtcDate,
  getBrazilCivilDate,
} from "./billing-settings.ts";

export const OVERDUE_REMINDER_AFTER_DAY = 18;

/**
 * Cobrança atrasada elegível após o dia 18 do mês de vencimento
 * (ex.: vencimento 15/08 → a partir de 19/08).
 */
export function isAfterOverdueReminderDay(
  dueDate: string,
  now = new Date(),
  afterDay = OVERDUE_REMINDER_AFTER_DAY,
): boolean {
  const parts = dueDate.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  if (!year || !month) return false;
  const monthIndex = month - 1;
  const thresholdIso = formatUtcDate(year, monthIndex, afterDay);
  const { year: ty, monthIndex: tm, day: td } = getBrazilCivilDate(now);
  const todayIso = formatUtcDate(ty, tm, td);
  return todayIso > thresholdIso;
}

export function buildOverdueReminderMessage(params: {
  academyName: string;
  studentName: string;
  referenceMonth: string;
  dueDate: string;
  boletoUrl: string;
  financeContact: string;
  financeWhatsapp: string;
}): string {
  const [y, m] = params.referenceMonth.split("-").map(Number);
  const monthLabel =
    y && m ? formatMonthLabelPt(y, m - 1) : params.referenceMonth;
  const dueLabel = formatDateLabelPt(params.dueDate);

  return [
    params.academyName,
    "",
    `Olá ${params.studentName}!`,
    "",
    `Identificamos que sua mensalidade de ${monthLabel} ainda está em aberto.`,
    `O vencimento foi em ${dueLabel}.`,
    `Segue novamente o link para pagamento: ${params.boletoUrl}`,
    "",
    `Dúvidas: ${params.financeContact} - ${params.financeWhatsapp}`,
    "OSS!",
  ].join("\n");
}

export const OVERDUE_BILLING_STATUSES = [
  "pendente",
  "gerado",
  "enviado_whatsapp",
  "vencido",
] as const;

export function canReprocessFailedBilling(status: string): boolean {
  return status === "cancelado" || status === "falhou";
}
