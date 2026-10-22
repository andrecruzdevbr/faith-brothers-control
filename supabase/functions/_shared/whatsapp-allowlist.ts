import { toEvolutionNumber } from "./phone.ts";

export const WHATSAPP_RECIPIENT_NOT_ALLOWED = "recipient_not_allowed";

/**
 * null = no extra restriction (Production default).
 * [] = env is set but empty → block every recipient.
 */
export function parseWhatsAppAllowedRecipients(
  raw: string | undefined | null,
): string[] | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const numbers = trimmed
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => toEvolutionNumber(part));
  return [...new Set(numbers)];
}

export function isWhatsAppRecipientAllowed(
  recipient: string,
  allowed: string[] | null,
): boolean {
  if (allowed == null) return true;
  return allowed.includes(toEvolutionNumber(recipient));
}
