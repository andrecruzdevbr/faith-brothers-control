export type AcademyBillingSettings = {
  boleto_issue_day: number;
  boleto_due_day: number;
  send_whatsapp_automatically: boolean;
};

export type BillingProcessedEntry = {
  studentId: string;
  studentName?: string;
  billingId?: string;
  status: string;
  stage?: string;
  error?: string;
  asaasHttpStatus?: number;
  asaasDescription?: string;
};

export type BillingRunSummary = {
  created: number;
  alreadyExists: number;
  skippedMissingPlan: number;
  skippedMissingTaxId: number;
  skippedMissingWhatsApp: number;
  skippedBeforeIssueDay: number;
  skippedOther: number;
  whatsappSent: number;
  whatsappSkipped: number;
  errors: number;
};

/** PostgREST may return one-to-one embeds as object or array. */
export function getBillingSettings(
  value: AcademyBillingSettings | AcademyBillingSettings[] | null | undefined,
): AcademyBillingSettings | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function getMissingBillingSkipStatus(
  hasPlan: boolean,
  hasSettings: boolean,
): string | null {
  if (hasPlan && hasSettings) return null;
  if (!hasPlan && !hasSettings) return "skipped_missing_plan_and_settings";
  if (!hasPlan) return "skipped_missing_plan";
  return "skipped_missing_billing_settings";
}

export function hasValidStudentWhatsapp(whatsapp: string | null | undefined): boolean {
  const digits = String(whatsapp ?? "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) {
    return digits.slice(2).length >= 10;
  }
  return digits.length >= 10;
}

/** Manual admin run can force generation before issue day. */
export function shouldSkipBeforeIssueDay(
  today: number,
  issueDay: number,
  force: boolean,
): boolean {
  if (force) return false;
  return today < issueDay;
}

/**
 * Cron uses academy setting. Manual body can override with sendWhatsApp true/false.
 */
export function resolveSendWhatsApp(
  settingsAuto: boolean,
  sendWhatsAppOverride: boolean | undefined,
): boolean {
  if (typeof sendWhatsAppOverride === "boolean") return sendWhatsAppOverride;
  return settingsAuto;
}

export function summarizeBillingProcessed(
  processed: BillingProcessedEntry[],
): BillingRunSummary {
  const summary: BillingRunSummary = {
    created: 0,
    alreadyExists: 0,
    skippedMissingPlan: 0,
    skippedMissingTaxId: 0,
    skippedMissingWhatsApp: 0,
    skippedBeforeIssueDay: 0,
    skippedOther: 0,
    whatsappSent: 0,
    whatsappSkipped: 0,
    errors: 0,
  };

  for (const row of processed) {
    switch (row.status) {
      case "generated":
        summary.created += 1;
        break;
      case "sent_whatsapp":
        summary.created += 1;
        summary.whatsappSent += 1;
        break;
      case "queued_whatsapp_send_disabled":
        summary.created += 1;
        summary.whatsappSkipped += 1;
        break;
      case "already_exists":
        summary.alreadyExists += 1;
        break;
      case "skipped_missing_plan":
      case "skipped_missing_plan_and_settings":
      case "skipped_missing_billing_settings":
        summary.skippedMissingPlan += 1;
        break;
      case "skipped_missing_tax_id":
        summary.skippedMissingTaxId += 1;
        break;
      case "skipped_missing_whatsapp":
        summary.skippedMissingWhatsApp += 1;
        break;
      case "skipped_before_issue_day":
        summary.skippedBeforeIssueDay += 1;
        break;
      case "failed":
        summary.errors += 1;
        break;
      case "whatsapp_sent":
        summary.whatsappSent += 1;
        break;
      case "whatsapp_skipped":
      case "whatsapp_skipped_missing_recipient":
      case "whatsapp_skipped_no_boleto":
      case "whatsapp_skipped_paid":
      case "whatsapp_already_sent":
        summary.whatsappSkipped += 1;
        break;
      default:
        if (row.status.startsWith("skipped_")) summary.skippedOther += 1;
        break;
    }
  }

  return summary;
}

export function formatBillingSettingsLabel(settings: {
  boleto_issue_day: number;
  boleto_due_day: number;
  send_whatsapp_automatically: boolean;
}): string {
  return `Emissão dia ${settings.boleto_issue_day} • Vencimento dia ${settings.boleto_due_day}${
    settings.send_whatsapp_automatically ? " • Envio automático ativo" : " • Envio manual"
  }`;
}

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export type BillingPeriod = {
  referenceMonth: string;
  dueDate: string;
  issueDate: string;
  year: number;
  monthIndex: number;
  dueDay: number;
  labelPt: string;
  dueDateLabelPt: string;
};

export function formatUtcDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function formatDateLabelPt(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

export function formatMonthLabelPt(year: number, monthIndex: number): string {
  return `${MONTH_NAMES_PT[monthIndex] ?? "Mês"}/${year}`;
}

/** Civil date in America/Sao_Paulo (academia BR). */
export function getBrazilCivilDate(now = new Date()): {
  year: number;
  monthIndex: number;
  day: number;
} {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [yearStr, monthStr, dayStr] = formatted.split("-");
  return {
    year: Number(yearStr),
    monthIndex: Number(monthStr) - 1,
    day: Number(dayStr),
  };
}

export function buildBillingPeriod(
  year: number,
  monthIndex: number,
  dueDay: number,
  issueDay = 1,
): BillingPeriod {
  const safeDue = Math.min(Math.max(dueDay, 1), 28);
  const safeIssue = Math.min(Math.max(issueDay, 1), safeDue);
  const referenceMonth = formatUtcDate(year, monthIndex, 1);
  const dueDate = formatUtcDate(year, monthIndex, safeDue);
  const issueDate = formatUtcDate(year, monthIndex, safeIssue);
  return {
    referenceMonth,
    dueDate,
    issueDate,
    year,
    monthIndex,
    dueDay: safeDue,
    labelPt: formatMonthLabelPt(year, monthIndex),
    dueDateLabelPt: formatDateLabelPt(dueDate),
  };
}

/**
 * Antes/no dia de vencimento → mês atual.
 * Depois do dia de vencimento → próximo mês.
 * Ex.: 29/07/2026 + dueDay 15 → Agosto/2026 (15/08/2026).
 */
export function resolveDefaultBillingPeriod(
  now: Date,
  dueDay: number,
  issueDay = 1,
): BillingPeriod {
  const { year, monthIndex, day } = getBrazilCivilDate(now);
  let y = year;
  let m = monthIndex;
  if (day > dueDay) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return buildBillingPeriod(y, m, dueDay, issueDay);
}

export function parseReferenceMonthInput(
  input: string | null | undefined,
): { year: number; monthIndex: number } | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

export function isDueDateBeforeToday(dueDate: string, now = new Date()): boolean {
  const { year, monthIndex, day } = getBrazilCivilDate(now);
  const todayIso = formatUtcDate(year, monthIndex, day);
  return dueDate < todayIso;
}

export type ResolveBillingPeriodResult = {
  period: BillingPeriod;
  adjusted: boolean;
  error?: string;
};

/**
 * Resolve período para geração.
 * - Sem referenceMonth: próxima referência válida (não gera vencimento no passado).
 * - Com referenceMonth no passado: ajusta para a próxima válida (manual) ou erro se rejectPast=true.
 */
export function resolveBillingPeriod(params: {
  now?: Date;
  dueDay: number;
  issueDay?: number;
  referenceMonth?: string | null;
  rejectPast?: boolean;
}): ResolveBillingPeriodResult {
  const now = params.now ?? new Date();
  const issueDay = params.issueDay ?? 1;
  const dueDay = params.dueDay;

  const parsed = parseReferenceMonthInput(params.referenceMonth);
  if (!parsed) {
    return {
      period: resolveDefaultBillingPeriod(now, dueDay, issueDay),
      adjusted: false,
    };
  }

  const requested = buildBillingPeriod(parsed.year, parsed.monthIndex, dueDay, issueDay);
  if (!isDueDateBeforeToday(requested.dueDate, now)) {
    return { period: requested, adjusted: false };
  }

  if (params.rejectPast) {
    return {
      period: requested,
      adjusted: false,
      error: `Vencimento ${requested.dueDateLabelPt} é anterior a hoje. Escolha ${resolveDefaultBillingPeriod(now, dueDay, issueDay).labelPt} ou um mês futuro.`,
    };
  }

  return {
    period: resolveDefaultBillingPeriod(now, dueDay, issueDay),
    adjusted: true,
  };
}

/** Opções de seletor: mês atual (se ainda válido), próximo e futuros. */
export function listSelectableBillingPeriods(
  now: Date,
  dueDay: number,
  issueDay = 1,
  futureMonths = 3,
): BillingPeriod[] {
  const defaultPeriod = resolveDefaultBillingPeriod(now, dueDay, issueDay);
  const options: BillingPeriod[] = [defaultPeriod];
  for (let i = 1; i <= futureMonths; i++) {
    let y = defaultPeriod.year;
    let m = defaultPeriod.monthIndex + i;
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    options.push(buildBillingPeriod(y, m, dueDay, issueDay));
  }
  return options;
}
