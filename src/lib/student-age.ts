/** Validação de data de nascimento / responsável (aluno). */

export type BirthValidationInput = {
  birthDate?: string | null;
  guardianName?: string | null;
  /** Data de referência (YYYY-MM-DD ou Date). Default: hoje local. */
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
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
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

/** Idade em anos completos na data de referência. */
export function getAgeYears(birthDate: string, today?: string | Date): number | null {
  const birth = parseDateOnly(birthDate);
  if (!birth) return null;
  const now = toYmd(today);
  let age = now.y - birth.y;
  if (now.m < birth.m || (now.m === birth.m && now.d < birth.d)) age -= 1;
  return age;
}

export function isMinor(birthDate: string, today?: string | Date): boolean {
  const age = getAgeYears(birthDate, today);
  return age !== null && age < 18;
}

/**
 * Valida birth_date + guardian_name.
 * Retorna mensagem de erro em português ou null se ok.
 */
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

export function formatBirthDateDisplay(birthDate: string | null | undefined): string {
  if (!birthDate) return "Não informada";
  const parsed = parseDateOnly(birthDate);
  if (!parsed) return "Não informada";
  const dd = String(parsed.d).padStart(2, "0");
  const mm = String(parsed.m).padStart(2, "0");
  return `${dd}/${mm}/${parsed.y}`;
}

export function formatAgeDisplay(birthDate: string | null | undefined, today?: string | Date): string {
  if (!birthDate) return "—";
  const age = getAgeYears(birthDate, today);
  if (age === null || age < 0) return "—";
  return `${age} ${age === 1 ? "ano" : "anos"}`;
}

export function firstNameFromFullName(fullName: string): string {
  const part = fullName.trim().split(/\s+/)[0];
  return part || "aluno";
}
