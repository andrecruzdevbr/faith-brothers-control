/** Pure helpers for Family Plan registration V2 (testable, no I/O). */

import { BELTS } from "@/lib/constants";
import { isMinor, validateStudentBirthFields } from "@/lib/student-age";

export const FAMILY_RELATIONSHIPS = [
  "filho",
  "filha",
  "cônjuge",
  "irmão",
  "irmã",
  "neto",
  "neta",
  "outro",
] as const;

export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];

export const MAX_BELT_DEGREES = 4;

export type FamilyWizardMemberDraft = {
  key: string;
  mode: "new" | "link";
  fullName: string;
  birthDate: string;
  belt: string;
  degrees: number;
  trainingDays: number;
  relationship: string;
  guardianName: string;
  notes: string;
  existingStudentId?: string;
};

export type FamilyWizardResponsibleDraft = {
  fullName: string;
  whatsapp: string;
  birthDate: string;
  email: string;
  billingTaxId: string;
  trains: boolean | null;
  belt: string;
  degrees: number;
  trainingDays: number;
  guardianName: string;
  familyName: string;
  password: string;
  confirmPassword: string;
};

export function createEmptyMemberDraft(trainingDays = 3): FamilyWizardMemberDraft {
  return {
    key: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: "new",
    fullName: "",
    birthDate: "",
    belt: "Branca",
    degrees: 0,
    trainingDays,
    relationship: "filho",
    guardianName: "",
    notes: "",
  };
}

export function isValidBelt(belt: string): boolean {
  return (BELTS as readonly string[]).includes(belt);
}

export function isValidDegrees(degrees: number): boolean {
  return Number.isInteger(degrees) && degrees >= 0 && degrees <= MAX_BELT_DEGREES;
}

export function validatePractitionerSports(input: {
  belt: string;
  degrees: number;
  trainingDays: number;
  label?: string;
}): string | null {
  const label = input.label ?? "praticante";
  if (!isValidBelt(input.belt)) {
    return `Informe a faixa atual de cada ${label}.`;
  }
  if (!isValidDegrees(input.degrees)) {
    return `Quantidade de graus inválida (0 a ${MAX_BELT_DEGREES}).`;
  }
  if (input.trainingDays < 1 || input.trainingDays > 7) {
    return `Frequência semanal de cada ${label} deve ser entre 1 e 7.`;
  }
  return null;
}

export function validateFamilyWizardMembers(
  members: FamilyWizardMemberDraft[],
  options?: { responsibleTrains?: boolean | null },
): { ok: true } | { ok: false; error: string } {
  const responsibleTrains = options?.responsibleTrains === true;
  if (!members.length) {
    return {
      ok: false,
      error: responsibleTrains
        ? "Adicione ao menos um integrante além do responsável."
        : "Adicione ao menos um integrante que treina (o responsável não treina).",
    };
  }

  const linked = new Set<string>();
  for (const m of members) {
    if (m.mode === "link") {
      if (!m.existingStudentId) {
        return { ok: false, error: "Selecione o aluno existente para vincular." };
      }
      if (linked.has(m.existingStudentId)) {
        return { ok: false, error: "Não vincule o mesmo aluno duas vezes." };
      }
      linked.add(m.existingStudentId);
      const sports = validatePractitionerSports({
        belt: m.belt || "Branca",
        degrees: m.degrees,
        trainingDays: m.trainingDays,
        label: "integrante vinculado",
      });
      if (sports) return { ok: false, error: sports };
      continue;
    }

    if (m.fullName.trim().length < 3) {
      return { ok: false, error: "Informe o nome completo de cada integrante." };
    }
    if (!m.birthDate) {
      return { ok: false, error: "Informe a data de nascimento de cada integrante." };
    }
    const birthError = validateStudentBirthFields({
      birthDate: m.birthDate,
      guardianName: m.guardianName,
    });
    if (birthError) return { ok: false, error: birthError };

    if (!m.relationship.trim()) {
      return { ok: false, error: "Informe o parentesco de cada integrante." };
    }

    const sports = validatePractitionerSports({
      belt: m.belt,
      degrees: m.degrees,
      trainingDays: m.trainingDays,
      label: "integrante",
    });
    if (sports) return { ok: false, error: sports };
  }
  return { ok: true };
}

export function buildFamilyWizardMemberPayload(members: FamilyWizardMemberDraft[]) {
  return members.map((m) => {
    if (m.mode === "link" && m.existingStudentId) {
      return {
        existing_student_id: m.existingStudentId,
        full_name: m.fullName.trim() || undefined,
        training_days: m.trainingDays,
        belt: m.belt || undefined,
        degrees: m.degrees,
        relationship: m.relationship.trim() || "integrante",
        notes: m.notes.trim() || null,
      };
    }
    return {
      full_name: m.fullName.trim(),
      birth_date: m.birthDate,
      belt: m.belt,
      degrees: m.degrees,
      training_days: m.trainingDays,
      relationship: m.relationship.trim() || "integrante",
      guardian_name: isMinor(m.birthDate) ? m.guardianName.trim() || null : null,
      notes: m.notes.trim() || null,
    };
  });
}

/** Reference-only share; never used for revenue multiplication. */
export function familyPerMemberShare(total: number, memberCount: number): number | null {
  if (!memberCount || memberCount < 1 || !Number.isFinite(total)) return null;
  return Math.round((total / memberCount) * 100) / 100;
}

export function countFamilyPractitioners(
  responsibleTrains: boolean,
  membersCount: number,
): number {
  return (responsibleTrains ? 1 : 0) + membersCount;
}

export function formatBeltDegreesLabel(belt: string, degrees: number): string {
  const d = Number.isFinite(degrees) ? degrees : 0;
  return `${belt}, ${d} ${d === 1 ? "grau" : "graus"}`;
}
