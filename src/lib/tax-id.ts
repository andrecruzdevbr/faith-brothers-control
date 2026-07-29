/** Digits-only CPF (11) or CNPJ (14). */
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

export function maskTaxId(raw: string | null | undefined): string | null {
  const digits = normalizeTaxId(raw ?? "");
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  return null;
}

/** Remove CPF/CNPJ patterns and secrets from error text before logging or API responses. */
export function sanitizeBillingError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/access_token["\s:=]+[^"\s,}]+/gi, "access_token=[REDACTED]")
    .replace(/apikey["\s:=]+[^"\s,}]+/gi, "apikey=[REDACTED]")
    .replace(/service_role["\s:=]+[^"\s,}]+/gi, "service_role=[REDACTED]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[documento]")
    .replace(/\b\d{11}\b/g, "[documento]")
    .replace(/\b\d{14}\b/g, "[documento]");
}

export function extractStudentTaxId(
  value: { tax_id: string | null } | { tax_id: string | null }[] | null | undefined,
): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  const digits = row?.tax_id ? normalizeTaxId(row.tax_id) : "";
  return isValidTaxId(digits) ? digits : null;
}

export function hasBillableTaxId(
  value: { tax_id: string | null } | { tax_id: string | null }[] | null | undefined,
): boolean {
  return extractStudentTaxId(value) !== null;
}

export type MaskedTaxIdInfo = {
  masked: string | null;
  has_tax_id: boolean;
};

/** Label seguro para listagens — nunca expõe CPF/CNPJ completo. */
export function formatBillingTaxIdLabel(info: MaskedTaxIdInfo | null | undefined): string {
  if (info?.has_tax_id && info.masked) return info.masked;
  if (info?.has_tax_id) return "Cadastrado";
  return "Não informado";
}

export function isMissingBillingTaxId(info: MaskedTaxIdInfo | null | undefined): boolean {
  return !info?.has_tax_id;
}
