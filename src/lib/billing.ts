export function formatBillingSettingsLabel(settings: {
  boleto_issue_day: number;
  boleto_due_day: number;
  send_whatsapp_automatically: boolean;
}): string {
  return `Emissão dia ${settings.boleto_issue_day} • Vencimento dia ${settings.boleto_due_day}${
    settings.send_whatsapp_automatically ? " • Envio automático ativo" : " • Envio manual"
  }`;
}

export type BillingErrorDetail = {
  studentId: string;
  studentName?: string;
  status: string;
  stage?: string;
  error?: string;
  asaasHttpStatus?: number;
  asaasDescription?: string;
};

export function summarizeBillingRunText(summary: {
  created: number;
  alreadyExists: number;
  skippedMissingPlan: number;
  skippedMissingTaxId: number;
  skippedMissingWhatsApp: number;
  whatsappSent: number;
  whatsappSkipped: number;
  errors: number;
}): string[] {
  return [
    `Cobranças criadas: ${summary.created}`,
    `Já existentes: ${summary.alreadyExists}`,
    `Ignorados sem plano: ${summary.skippedMissingPlan}`,
    `Ignorados sem CPF/CNPJ: ${summary.skippedMissingTaxId}`,
    `Ignorados sem WhatsApp: ${summary.skippedMissingWhatsApp}`,
    `Mensagens enviadas: ${summary.whatsappSent}`,
    `Mensagens ignoradas/skipped: ${summary.whatsappSkipped}`,
    `Erros: ${summary.errors}`,
  ];
}

export function formatBillingErrorDetail(entry: BillingErrorDetail): string {
  const name = entry.studentName?.trim() || "Aluno";
  const stage = entry.stage ? `etapa ${entry.stage}` : "etapa desconhecida";
  const asaas =
    entry.asaasHttpStatus != null
      ? `Asaas HTTP ${entry.asaasHttpStatus}${entry.asaasDescription ? ` — ${entry.asaasDescription}` : ""}`
      : null;
  const message = entry.asaasDescription
    ? entry.asaasDescription
    : entry.error?.trim() || "Erro desconhecido";
  const main = asaas ?? message;
  return `${name} (${entry.studentId.slice(0, 8)}…) — ${stage}: ${main}`;
}

export function collectBillingErrors(
  processed?: BillingErrorDetail[] | null,
  errors?: BillingErrorDetail[] | null,
): BillingErrorDetail[] {
  if (Array.isArray(errors) && errors.length > 0) return errors;
  return (processed ?? []).filter((row) => row.status === "failed");
}

export {
  buildBillingPeriod,
  isDueDateBeforeToday,
  listSelectableBillingPeriods,
  resolveBillingPeriod,
  resolveDefaultBillingPeriod,
  type BillingPeriod,
} from "../../supabase/functions/_shared/billing-settings.ts";
