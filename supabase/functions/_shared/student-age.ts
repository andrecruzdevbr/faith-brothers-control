/** Validação de data de nascimento / responsável (Edge / Deno). */

export type BirthValidationInput = {
  birthDate?: string | null;
  guardianName?: string | null;
  today?: string | Date;
};

function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

function toYmd(today: string | Date | undefined): { y: number; m: number; d: number } {
  if (typeof today === "string") {
    const parsed = parseDateOnly(today);
    if (parsed) return parsed;
  }
  const base = today instanceof Date ? today : new Date();
  return { y: base.getFullYear(), m: base.getMonth() + 1, d: base.getDate() };
}

export function getAgeYears(birthDate: string, today?: string | Date): number | null {
  const birth = parseDateOnly(birthDate);
  if (!birth) return null;
  const now = toYmd(today);
  let age = now.y - birth.y;
  if (now.m < birth.m || (now.m === birth.m && now.d < birth.d)) age -= 1;
  return age;
}

export function validateStudentBirthFields(input: BirthValidationInput): string | null {
  const raw = String(input.birthDate ?? "").trim();
  if (!raw) return "Informe a data de nascimento.";

  const birth = parseDateOnly(raw);
  if (!birth) return "Confira a data de nascimento informada.";

  const now = toYmd(input.today);
  const birthOrdinal = birth.y * 10000 + birth.m * 100 + birth.d;
  const todayOrdinal = now.y * 10000 + now.m * 100 + now.d;

  if (birthOrdinal > todayOrdinal) {
    return "A data de nascimento não pode ser futura.";
  }

  const age = getAgeYears(raw, input.today);
  if (age === null || age < 0) return "Confira a data de nascimento informada.";
  if (age > 100) return "Confira a data de nascimento informada.";

  const guardian = String(input.guardianName ?? "").trim();
  if (age < 18 && !guardian) {
    return "Informe o nome do responsável para alunos menores de idade.";
  }

  return null;
}

export function firstNameFromFullName(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part || "aluno";
}

/** Data civil America/Sao_Paulo como YYYY-MM-DD. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
