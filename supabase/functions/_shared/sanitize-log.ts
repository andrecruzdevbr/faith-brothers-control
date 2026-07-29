const REDACTED = "[REDACTED]";

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bapikey\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\bapi[_-]?key\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\btoken\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\bbearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bauthorization\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\bservice[_-]?role\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\bSUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\bWHATSAPP_EVOLUTION_API_KEY\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\bAUTHENTICATION_API_KEY\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
  /\bEVOLUTION_API_KEY\s*[:=]\s*["']?[^"'&\s,;]+["']?/gi,
];

/**
 * Sanitizes unknown errors for safe logging / HTTP responses.
 * Never returns raw API keys, tokens, or auth headers.
 */
export function sanitizeLogError(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = error.message || error.name || "Unknown error";
  } else if (typeof error === "string") {
    raw = error;
  } else if (error == null) {
    raw = "Unknown error";
  } else {
    try {
      raw = JSON.stringify(error);
    } catch {
      raw = String(error);
    }
  }

  let sanitized = raw;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }

  // Extra pass for bare secret-looking assignments after known env names in free text
  sanitized = sanitized.replace(
    /\b(apikey|api_key|api-key|token|authorization|bearer|service_role|SUPABASE_SERVICE_ROLE_KEY|WHATSAPP_EVOLUTION_API_KEY|AUTHENTICATION_API_KEY|EVOLUTION_API_KEY)\b/gi,
    REDACTED,
  );

  return sanitized.trim() || "Unknown error";
}

export function logSafeError(
  label: string,
  context: Record<string, unknown>,
  error: unknown,
): void {
  console.error(label, {
    ...context,
    errorType: error instanceof Error ? error.name : typeof error,
    error: sanitizeLogError(error),
  });
}
