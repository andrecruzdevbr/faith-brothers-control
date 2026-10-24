export const ADMIN_WHATSAPP_FIELDS_REQUIRED = "numero e mensagem são obrigatórios";
export const ADMIN_WHATSAPP_NUMBER_INVALID = "numero WhatsApp inválido";

export function normalizeWhatsapp(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) return digits.slice(2);
  return digits;
}

export function toEvolutionNumber(raw: string): string {
  const clean = normalizeWhatsapp(raw);
  return clean.startsWith("55") ? clean : `55${clean}`;
}

export function isValidWhatsAppNumber(raw: string | null | undefined): boolean {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) {
    return digits.slice(2).length >= 10;
  }
  return digits.length >= 10;
}

export function parseAdminWhatsAppSendRequest(input: {
  numero?: unknown;
  mensagem?: unknown;
}): { ok: true; recipient: string; body: string } | { ok: false; error: string } {
  const numero = input.numero == null ? "" : String(input.numero);
  const mensagem = input.mensagem == null ? "" : String(input.mensagem);
  if (!numero.trim() || !mensagem.trim()) {
    return { ok: false, error: ADMIN_WHATSAPP_FIELDS_REQUIRED };
  }
  if (!isValidWhatsAppNumber(numero)) {
    return { ok: false, error: ADMIN_WHATSAPP_NUMBER_INVALID };
  }
  return { ok: true, recipient: numero.trim(), body: mensagem };
}

export function toSyntheticEmail(whatsapp: string): string {
  return `${normalizeWhatsapp(whatsapp)}@wa.faithbrothers.app`;
}
