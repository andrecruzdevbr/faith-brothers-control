import { sanitizeBillingError } from "./tax-id.ts";

export function mapRegisterStudentRpcError(message: string): { status: number; error: string } {
  const lower = message.toLowerCase();
  const isDuplicate =
    lower.includes("já está cadastrado") ||
    lower.includes("duplicate") ||
    lower.includes("unique");

  if (isDuplicate && (lower.includes("cpf") || lower.includes("cnpj") || lower.includes("tax_id"))) {
    return { status: 409, error: "Este CPF/CNPJ já está cadastrado." };
  }

  if (isDuplicate && (lower.includes("whatsapp") || lower.includes("este whatsapp"))) {
    return { status: 409, error: "Este WhatsApp já está cadastrado." };
  }

  if (isDuplicate) {
    return { status: 409, error: "Este WhatsApp já está cadastrado." };
  }

  if (
    (lower.includes("cpf") || lower.includes("cnpj") || lower.includes("tax_id")) &&
    lower.includes("inválido")
  ) {
    return {
      status: 400,
      error: "CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).",
    };
  }

  return { status: 500, error: sanitizeBillingError(message) };
}
