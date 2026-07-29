export function buildRegistrationReceivedMessage(fullName: string): string {
  const name = fullName.trim() || "aluno";
  return [
    `Olá, ${name}! Seu cadastro na Faith Brothers Control foi recebido com sucesso.`,
    "",
    "Agora é só aguardar a aprovação da academia.",
    "",
    "Assim que seu acesso for aprovado, você poderá entrar no sistema usando seu WhatsApp e senha cadastrada.",
  ].join("\n");
}

export function buildPasswordResetOtpMessage(code: string, expiryMinutes: number): string {
  return [
    `Fala, irmão! Seu código de recuperação é: *${code}*`,
    "",
    `Ele é válido por ${expiryMinutes} minutos.`,
    "",
    "Faith Brothers Control 🥋",
  ].join("\n");
}

export type WhatsAppDispatchInfo = {
  queued: boolean;
  skipped?: boolean;
  reason?: string;
};

export function toWhatsAppDispatchInfo(result: {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
}): WhatsAppDispatchInfo {
  return {
    queued: true,
    skipped: result.skipped ?? false,
    reason: result.reason,
  };
}
