export function normalizeWhatsapp(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) return digits.slice(2);
  return digits;
}

export function toEvolutionNumber(raw: string): string {
  const clean = normalizeWhatsapp(raw);
  return clean.startsWith("55") ? clean : `55${clean}`;
}

export function toSyntheticEmail(whatsapp: string): string {
  return `${normalizeWhatsapp(whatsapp)}@wa.faithbrothers.app`;
}
