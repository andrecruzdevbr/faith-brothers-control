export type SendWhatsAppFunctionResponse = {
  success?: boolean;
  sent?: boolean;
  skipped?: boolean;
  reason?: string | null;
  error?: string | null;
  number?: string;
};

export type WhatsAppTestOutcomeKind = "sent" | "skipped" | "error";

export type WhatsAppTestOutcome = {
  kind: WhatsAppTestOutcomeKind;
  title: string;
  details: string;
  toastTitle: string;
  toastVariant?: "destructive";
};

export const WHATSAPP_TEST_ACCEPTED_TITLE = "Mensagem aceita para envio";
export const WHATSAPP_TEST_SKIPPED_TITLE = "Envio ignorado";
export const WHATSAPP_TEST_ERROR_TITLE = "Falha no envio";
export const WHATSAPP_TEST_DISABLED_DETAILS =
  "O envio de WhatsApp está desabilitado neste ambiente. A mensagem não foi enviada.";
export const WHATSAPP_TEST_NOT_SENT_DETAILS = "A mensagem não foi enviada.";
export const WHATSAPP_TEST_NO_DELIVERY_CONFIRMATION =
  "A entrega no WhatsApp ainda não foi confirmada.";

export function interpretSendWhatsAppTestResponse(
  data: SendWhatsAppFunctionResponse,
  formattedNumber: string,
): WhatsAppTestOutcome {
  if (data.success === false || (data.error && data.sent !== true)) {
    return {
      kind: "error",
      title: WHATSAPP_TEST_ERROR_TITLE,
      details: data.error?.trim() || "Erro desconhecido",
      toastTitle: "Erro ao enviar",
      toastVariant: "destructive",
    };
  }

  if (data.sent === true) {
    return {
      kind: "sent",
      title: WHATSAPP_TEST_ACCEPTED_TITLE,
      details: `Aceita para envio para ${formattedNumber}. ${WHATSAPP_TEST_NO_DELIVERY_CONFIRMATION}`,
      toastTitle: WHATSAPP_TEST_ACCEPTED_TITLE,
    };
  }

  const reason = (data.reason ?? "").trim();
  const details = /WHATSAPP_SEND_ENABLED=false/i.test(reason) || (data.skipped === true && !reason)
    ? WHATSAPP_TEST_DISABLED_DETAILS
    : reason
      ? `${WHATSAPP_TEST_NOT_SENT_DETAILS} Motivo: ${reason}.`
      : WHATSAPP_TEST_NOT_SENT_DETAILS;

  return {
    kind: "skipped",
    title: WHATSAPP_TEST_SKIPPED_TITLE,
    details,
    toastTitle: WHATSAPP_TEST_SKIPPED_TITLE,
  };
}
