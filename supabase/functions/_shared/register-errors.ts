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

  if (lower.includes("selecione um plano") || lower.includes("plano desejado")) {
    return { status: 400, error: "Selecione um plano desejado." };
  }

  if (lower.includes("plano inválido") || lower.includes("plano inativo")) {
    return {
      status: 400,
      error: "Plano inválido ou inativo. Cadastre um plano ativo antes de vincular.",
    };
  }

  if (lower.includes("data de nascimento")) {
    if (lower.includes("futura")) {
      return { status: 400, error: "A data de nascimento não pode ser futura." };
    }
    if (lower.includes("confira")) {
      return { status: 400, error: "Confira a data de nascimento informada." };
    }
    return { status: 400, error: "Informe a data de nascimento." };
  }

  if (lower.includes("responsável") && lower.includes("menor")) {
    return {
      status: 400,
      error: "Informe o nome do responsável para alunos menores de idade.",
    };
  }

  return { status: 500, error: sanitizeBillingError(message) };
}
