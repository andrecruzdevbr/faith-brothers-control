/** Domínio sintético usado pelo Supabase Auth para login via WhatsApp */
export const SYNTHETIC_EMAIL_DOMAIN = "wa.faithbrothers.app";

/**
 * Normalize a WhatsApp number to digits only (DDD + number).
 * Strips country code 55 if present.
 * Accepts formats like: +55 31 99308-2330, 5531993082330, 31993082330, (31) 98104-4156
 * Output: 31993082330 (10-11 digits)
 */
export function normalizeWhatsapp(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  // Remove country code 55 if present (12-13 digits starting with 55)
  if (digits.length >= 12 && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Validate that a WhatsApp number has the correct format (10-11 digits).
 */
export function isValidWhatsapp(whatsapp: string): boolean {
  const normalized = normalizeWhatsapp(whatsapp);
  return /^\d{10,11}$/.test(normalized);
}

/** Brazilian mobile signup/login: DDD + 9 digits (11 total). */
export function isValidBrazilianWhatsapp(whatsapp: string): boolean {
  return /^\d{11}$/.test(normalizeWhatsapp(whatsapp));
}

/**
 * Convert a WhatsApp number to a synthetic email for Supabase Auth.
 * e.g. "31981044156" → "31981044156@wa.faithbrothers.app"
 */
export function whatsappToEmail(whatsapp: string): string {
  const normalized = normalizeWhatsapp(whatsapp);
  return `${normalized}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Credenciais normalizadas para signInWithPassword.
 */
export function getLoginCredentials(whatsapp: string, password: string) {
  return {
    email: whatsappToEmail(whatsapp),
    password: password.trim(),
  };
}

/**
 * Format a WhatsApp number for display.
 * e.g. "31993082330" → "(31) 99308-2330"
 */
export function formatWhatsapp(digits: string): string {
  const d = normalizeWhatsapp(digits);
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return d;
}
