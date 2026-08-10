/** Shared WhatsApp copy for academy-facing student messages (testable, no I/O). */

export const FAITH_BROTHERS_WHATSAPP_SIGNATURE = [
  "Faith Brothers, TMJ! 👊",
  "Osss! 🥋🤼",
].join("\n");

export function withFaithBrothersSignature(bodyLines: string[]): string {
  const trimmed = bodyLines.join("\n").replace(/\s+$/g, "");
  return `${trimmed}\n\n${FAITH_BROTHERS_WHATSAPP_SIGNATURE}`;
}

export function buildRegistrationReceivedMessage(fullName: string): string {
  const name = fullName.trim() || "aluno";
  return withFaithBrothersSignature([
    `Olá, ${name}! 🥋`,
    "",
    "Seu cadastro na Faith Brothers foi recebido com sucesso.",
    "",
    "Agora é só aguardar a revisão da academia.",
    "Nenhum pagamento é considerado aprovado neste momento.",
  ]);
}

export type RegistrationApprovedVariant =
  | "card"
  | "boleto"
  | "veteran"
  | "family"
  | "generic";

export function resolveRegistrationApprovedVariant(input: {
  registrationAudience?: string | null;
  paymentReviewStatus?: string | null;
  pendingFamilyGroupId?: string | null;
  requestedPaymentMethod?: string | null;
}): RegistrationApprovedVariant {
  if (input.pendingFamilyGroupId) return "family";
  if (input.registrationAudience === "veterano") return "veteran";
  if (input.paymentReviewStatus === "aguardando_conferencia") return "card";
  const method = (input.requestedPaymentMethod ?? "").trim();
  if (method === "boleto" || method === "") return "boleto";
  return "generic";
}

/** Cadastro feito pelo ADM (já aprovado cadastralmente). Sem afirmar pagamento. */
export function buildAdminCreatedRegistrationApprovedMessage(
  fullName: string,
  variant: RegistrationApprovedVariant = "generic",
  trainingDays?: number | null,
): string {
  const name = fullName.trim() || "aluno";
  if (variant === "veteran") {
    return buildVeteranRegistrationApprovedMessage(fullName, trainingDays);
  }
  if (variant === "card") {
    return buildNewStudentCardRegistrationApprovedMessage(fullName);
  }
  return withFaithBrothersSignature([
    `Olá, ${name}! 🥋`,
    "",
    "Seu cadastro na Faith Brothers foi realizado e aprovado!",
    "",
    "Agora você já pode acompanhar pelo aplicativo as informações do seu plano",
    "e sua situação financeira.",
  ]);
}

/** NEW_STUDENT + cartão/maquininha: aprovação cadastral; pagamento ainda pendente. */
export function buildNewStudentCardRegistrationApprovedMessage(fullName: string): string {
  const name = fullName.trim() || "aluno";
  return withFaithBrothersSignature([
    `Olá, ${name}! 🥋`,
    "",
    "Seu cadastro na Faith Brothers foi aprovado!",
    "",
    "Seu plano foi registrado e agora estamos aguardando a confirmação do pagamento pela academia.",
    "",
    "Você pode acompanhar sua situação pelo aplicativo.",
  ]);
}

/** Novo aluno (boleto/genérico) — sem afirmar pagamento confirmado. */
export function buildNewStudentRegistrationApprovedMessage(fullName: string): string {
  const name = fullName.trim() || "aluno";
  return withFaithBrothersSignature([
    `Olá, ${name}! 🥋`,
    "",
    "Seu cadastro na Faith Brothers foi aprovado!",
    "",
    "Agora você já pode acompanhar pelo aplicativo as informações do seu plano",
    "e sua situação financeira.",
  ]);
}

/** Veterano — aprovação cadastral; plano/pagamento a definir. Sem preço. */
export function buildVeteranRegistrationApprovedMessage(
  fullName: string,
  _trainingDays?: number | null,
): string {
  const name = fullName.trim() || "aluno";
  void _trainingDays;
  return withFaithBrothersSignature([
    `Olá, ${name}! 🥋`,
    "",
    "Seu cadastro na Faith Brothers foi aprovado!",
    "",
    "Sua frequência de treino foi registrada.",
    "",
    "Agora nossa equipe irá definir com você o plano e a forma de pagamento.",
    "",
    "Você pode acompanhar sua situação pelo aplicativo.",
  ]);
}

export function buildRegistrationApprovedMessage(
  fullName: string,
  variant: RegistrationApprovedVariant = "generic",
  trainingDays?: number | null,
): string {
  if (variant === "veteran") {
    return buildVeteranRegistrationApprovedMessage(fullName, trainingDays);
  }
  if (variant === "card") {
    return buildNewStudentCardRegistrationApprovedMessage(fullName);
  }
  if (variant === "family") {
    const name = fullName.trim() || "aluno";
    return withFaithBrothersSignature([
      `Olá, ${name}! 🥋`,
      "",
      "O cadastro familiar na Faith Brothers foi aprovado!",
      "",
      "Agora você já pode acompanhar pelo aplicativo as informações do plano",
      "e a situação financeira da família.",
    ]);
  }
  return buildNewStudentRegistrationApprovedMessage(fullName);
}

/** @deprecated Prefer buildVeteranRegistrationApprovedMessage via registration_approved. */
export function buildVeteranPeriodRequestMessage(fullName: string, trainingDays?: number | null): string {
  return buildVeteranRegistrationApprovedMessage(fullName, trainingDays);
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

/** Evento financeiro distinto de registration_approved. */
export function buildContractApprovedMessage(params: {
  fullName: string;
  planName?: string | null;
  planKindLabel?: string | null;
  trainingDays?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  isFamily?: boolean;
}): string {
  const name = params.fullName.trim() || "aluno";
  const kind = (params.planKindLabel ?? "").trim();
  const days = params.trainingDays;
  const daysLabel =
    days === 1 ? "1 dia por semana" : days && days > 0 ? `${days} dias por semana` : null;
  const planLine =
    kind && daysLabel
      ? `Seu plano ${kind} de ${daysLabel} está ativo.`
      : `Seu plano ${(params.planName ?? "").trim() || "contratado"} está ativo.`;

  const lines = [
    `Olá, ${name}! 🥋`,
    "",
    "Pagamento confirmado!",
    "",
    planLine,
  ];
  if (params.isFamily) {
    lines.push("", "A cobertura está vinculada ao contrato familiar.");
  }
  if (params.startsOn && params.endsOn) {
    lines.push("", "Período liberado:", `${params.startsOn} até ${params.endsOn}`);
  }
  lines.push("", "Você já pode acompanhar os meses liberados pelo aplicativo.");
  return withFaithBrothersSignature(lines);
}

/** Idempotency for payment confirmation (never reuse registration_approved key). */
export function buildContractApprovedIdempotencyKey(contractId: string, event = "payment_confirmed"): string {
  return `contract_approved:${contractId}:${event}`;
}

export function buildPaymentConfirmedIdempotencyKey(contractId: string): string {
  return buildContractApprovedIdempotencyKey(contractId, "payment_confirmed");
}

export function buildBirthdayMessage(fullName: string, academyName?: string | null): string {
  const name = (fullName.trim().split(/\s+/)[0] || "aluno").trim();
  const academy = (academyName ?? "").trim() || "Faith Brothers BJJ";
  return withFaithBrothersSignature([
    `🎉 Parabéns, ${name}!`,
    "",
    `A equipe ${academy} deseja um feliz aniversário, muita saúde, evolução e muitas conquistas dentro e fora dos tatames.`,
  ]);
}

export function buildPasswordResetOtpMessage(code: string, expiryMinutes: number): string {
  return withFaithBrothersSignature([
    `Fala, irmão! Seu código de recuperação é: *${code}*`,
    "",
    `Ele é válido por ${expiryMinutes} minutos.`,
  ]);
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
