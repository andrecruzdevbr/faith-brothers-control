import { sanitizeLogError } from "./sanitize-log.ts";

const DEFAULT_MAX_LEN = 500;

/**
 * Masks a phone/WhatsApp number for logs (keeps prefix/suffix digits only).
 */
export function maskPhoneForLog(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "****";
  if (digits.length <= 4) return "*".repeat(digits.length);
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}****${digits.slice(-2)}`;
  }
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

function maskPhonesInText(text: string): string {
  // International BR-style runs of 10–15 digits (avoid wiping short ids)
  return text.replace(/\b(\d{10,15})\b/g, (match) => maskPhoneForLog(match));
}

function asPlainString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function extractExists(body: unknown): boolean | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  if (typeof root.exists === "boolean") return root.exists;

  const response = root.response;
  if (response && typeof response === "object") {
    const msg = (response as Record<string, unknown>).message;
    if (Array.isArray(msg)) {
      for (const item of msg) {
        if (item && typeof item === "object" && typeof (item as { exists?: unknown }).exists === "boolean") {
          return (item as { exists: boolean }).exists;
        }
      }
    }
    if (msg && typeof msg === "object" && !Array.isArray(msg) && typeof (msg as { exists?: unknown }).exists === "boolean") {
      return (msg as { exists: boolean }).exists;
    }
  }
  return null;
}

function extractResponseMessage(body: unknown): unknown {
  if (!body || typeof body !== "object") return null;
  const response = (body as Record<string, unknown>).response;
  if (!response || typeof response !== "object") return null;
  return (response as Record<string, unknown>).message ?? null;
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Builds a structured Evolution send error string for DB/logs.
 * Preserves useful fields (status, error, message, exists, response.message)
 * while masking phones and stripping secrets.
 */
export function formatEvolutionApiError(params: {
  httpStatus: number;
  instance: string;
  number: string;
  body: unknown;
  maxLen?: number;
}): string {
  const maxLen = params.maxLen ?? DEFAULT_MAX_LEN;
  const body = params.body;
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

  const statusFromBody =
    typeof root?.status === "number"
      ? root.status
      : typeof root?.statusCode === "number"
        ? root.statusCode
        : null;
  const errorField = asPlainString(root?.error);
  const messageField = (() => {
    if (!root) return null;
    if (typeof root.message === "string") return root.message;
    if (Array.isArray(root.message)) return safeJson(root.message);
    if (root.message && typeof root.message === "object") return safeJson(root.message);
    return null;
  })();
  const responseMessage = extractResponseMessage(body);
  const responseMessageText = responseMessage == null ? null : typeof responseMessage === "string"
    ? responseMessage
    : safeJson(responseMessage);
  const exists = extractExists(body);

  const parts: string[] = [
    `Evolution API [${params.httpStatus}]`,
    `instance=${params.instance}`,
    `number=${maskPhoneForLog(params.number)}`,
    `httpStatus=${params.httpStatus}`,
  ];

  if (statusFromBody != null) parts.push(`status=${statusFromBody}`);
  if (errorField) parts.push(`error=${errorField}`);
  if (messageField) parts.push(`message=${messageField}`);
  if (exists != null) parts.push(`exists=${exists}`);
  if (responseMessageText) parts.push(`response.message=${responseMessageText}`);

  // If Evolution returned an opaque non-object body, keep a short raw snippet.
  if (!root && body != null) {
    const raw = typeof body === "string" ? body : safeJson(body);
    if (raw) parts.push(`body=${raw}`);
  }

  const joined = parts.join(" ");
  const masked = maskPhonesInText(joined);
  const sanitized = sanitizeLogError(masked);
  return sanitized.length > maxLen ? `${sanitized.slice(0, maxLen - 1)}…` : sanitized;
}
