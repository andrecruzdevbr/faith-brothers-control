export function buildRegistrationReceivedMessage(fullName: string): string {
  const name = fullName.trim() || "aluno";
  return [
    `Olá, ${name}! Seu cadastro na Faith Brothers Control foi recebido com sucesso.`,
    "",
    "Agora é só aguardar a revisão da academia.",
    "",
    "Nenhum pagamento é considerado aprovado neste momento.",
    "Assim que houver novidades, avisaremos por aqui.",
  ].join("\n");
}

export function buildRegistrationApprovedMessage(fullName: string): string {
  const name = fullName.trim() || "aluno";
  return [
    `Olá, ${name}! Seu cadastro foi aprovado pela academia.`,
    "",
    "Em breve você receberá as orientações financeiras (boleto ou confirmação de pagamento).",
    "",
    "Faith Brothers Control 🥋",
  ].join("\n");
}

export function buildVeteranPeriodRequestMessage(fullName: string, trainingDays?: number | null): string {
  const name = fullName.trim() || "aluno";
  const days = trainingDays === 2 || trainingDays === 3 || trainingDays === 5
    ? `${trainingDays} dias`
    : "a frequência escolhida";
  return [
    `Olá, ${name}! Seu cadastro de veterano (${days}/semana) foi analisado.`,
    "",
    "Responda ou fale com a academia para escolher a modalidade:",
    "1) Mensal (boleto)",
    "2) Semestral (pagamento na maquininha)",
    "3) Anual (pagamento na maquininha)",
    "",
    "Cartão/maquininha só é liberado após confirmação do administrador.",
    "",
    "Faith Brothers Control 🥋",
  ].join("\n");
}

export function buildRegistrationReceivedIdempotencyKey(studentId: string): string {
  return `registration:${studentId}:received`;
}

export function buildRegistrationApprovedIdempotencyKey(studentId: string): string {
  return `registration:${studentId}:approved`;
}

export function buildVeteranPeriodRequestIdempotencyKey(studentId: string): string {
  return `registration:${studentId}:veteran_period_request`;
}

export function buildPaymentConfirmationIdempotencyKey(scope: string, entityId: string): string {
  return `payment_confirmation:${scope}:${entityId}`;
}

export function buildContractApprovedMessage(params: {
  fullName: string;
  planName?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  isFamily?: boolean;
}): string {
  const name = params.fullName.trim() || "aluno";
  const plan = (params.planName ?? "").trim() || "seu pacote";
  const lines = [
    `Olá, ${name}! Seu pagamento do ${plan} foi confirmado pela academia.`,
    "",
  ];
  if (params.isFamily) {
    lines.push("A cobertura está vinculada ao contrato familiar.");
  }
  if (params.startsOn && params.endsOn) {
    lines.push(`Período liberado: ${params.startsOn} até ${params.endsOn}.`);
  }
  lines.push("", "Faith Brothers Control 🥋");
  return lines.join("\n");
}

export function buildContractApprovedIdempotencyKey(contractId: string, event = "payment_confirmed"): string {
  return `contract_approved:${contractId}:${event}`;
}


export function buildBirthdayMessage(fullName: string, academyName?: string | null): string {
  const name = (fullName.trim().split(/\s+/)[0] || "aluno").trim();
  const academy = (academyName ?? "").trim() || "Faith Brothers BJJ";
  return `🎉 Parabéns, ${name}! A equipe ${academy} deseja um feliz aniversário, muita saúde, evolução e muitas conquistas dentro e fora dos tatames. Oss! 🥋`;
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
