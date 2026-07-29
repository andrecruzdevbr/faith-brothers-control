export type AcademyBillingSettings = {
  boleto_issue_day: number;
  boleto_due_day: number;
  send_whatsapp_automatically: boolean;
};

export type BillingProcessedEntry = {
  studentId: string;
  billingId?: string;
  status: string;
  stage?: string;
  error?: string;
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
