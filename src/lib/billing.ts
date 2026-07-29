export function formatBillingSettingsLabel(settings: {
  boleto_issue_day: number;
  boleto_due_day: number;
  send_whatsapp_automatically: boolean;
}): string {
  return `Emissão dia ${settings.boleto_issue_day} • Vencimento dia ${settings.boleto_due_day}${
    settings.send_whatsapp_automatically ? " • Envio automático ativo" : " • Envio manual"
  }`;
}

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
