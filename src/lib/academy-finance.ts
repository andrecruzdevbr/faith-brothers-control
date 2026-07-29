export const ASAAS_WEBHOOK_URL =
  "https://wojqjxtaqjasnfhbotxi.supabase.co/functions/v1/asaas-webhook";

export type AcademyFinanceDisplay = {
  finance_contact_name?: string | null;
  finance_whatsapp?: string | null;
  finance_document_display?: string | null;
  bank_name?: string | null;
  bank_code?: string | null;
  bank_branch?: string | null;
  bank_account?: string | null;
  asaas_environment_label?: string | null;
};

export function formatAsaasEnvironmentLabel(
  label: string | null | undefined,
): string {
  const normalized = (label ?? "").trim().toLowerCase();
  if (normalized === "sandbox") return "Asaas Sandbox";
  if (normalized === "production" || normalized === "produção" || normalized === "producao") {
    return "Asaas Produção configurado";
  }
  return "Asaas (via Secrets)";
}

/** Exibe CNPJ/MEI já parcial; nunca inventa dígitos ocultos. */
export function formatFinanceDocumentDisplay(
  value: string | null | undefined,
): string {
  const raw = (value ?? "").trim();
  return raw || "Não informado";
}

export function isLegacyFelipeFinanceContact(name: string | null | undefined): boolean {
  return (name ?? "").toLowerCase().includes("felipe");
}
