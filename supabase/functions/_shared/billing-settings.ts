export type AcademyBillingSettings = {
  boleto_issue_day: number;
  boleto_due_day: number;
  send_whatsapp_automatically: boolean;
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
