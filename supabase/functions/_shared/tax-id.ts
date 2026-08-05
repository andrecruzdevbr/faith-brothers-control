export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, "");
}

function allSameDigits(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

function calcCpfCheckDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  const mod = (sum * 10) % 11;
  return mod === 10 ? 0 : mod;
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || allSameDigits(digits)) return false;
  const d1 = calcCpfCheckDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcCpfCheckDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

function calcCnpjCheckDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || allSameDigits(digits)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calcCnpjCheckDigit(digits, w1);
  const d2 = calcCnpjCheckDigit(digits, w2);
  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

export function isValidTaxId(raw: string): boolean {
  const digits = normalizeTaxId(raw);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export function sanitizeBillingError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/access_token["\s:=]+[^"\s,}]+/gi, "access_token=[REDACTED]")
    .replace(/apikey["\s:=]+[^"\s,}]+/gi, "apikey=[REDACTED]")
    .replace(/service_role["\s:=]+[^"\s,}]+/gi, "service_role=[REDACTED]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[documento]")
    .replace(/\b\d{11}\b/g, "[documento]")
    .replace(/\b\d{14}\b/g, "[documento]");
}

/** Extrai status HTTP e descrição amigável de erro Asaas (sem documento completo). */
export function extractAsaasErrorDetails(rawMessage: string): {
  asaasHttpStatus?: number;
  asaasDescription?: string;
} {
  const statusMatch = rawMessage.match(/Asaas\s*\[(\d{3})\]/i);
  const asaasHttpStatus = statusMatch ? Number(statusMatch[1]) : undefined;

  let asaasDescription: string | undefined;
  const jsonStart = rawMessage.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
        errors?: Array<{ description?: string; code?: string }>;
        message?: string;
      };
      const first = parsed.errors?.[0];
      const desc = first?.description ?? parsed.message;
      if (desc) asaasDescription = sanitizeBillingError(String(desc));
    } catch {
      // ignore JSON parse failures
    }
  }

  if (!asaasDescription && asaasHttpStatus) {
    asaasDescription = sanitizeBillingError(rawMessage.replace(/^Asaas\s*\[\d{3}\]:\s*/i, "").slice(0, 240));
  }

  return { asaasHttpStatus, asaasDescription };
}
