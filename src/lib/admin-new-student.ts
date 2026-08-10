/** Admin “Novo Aluno” panel helpers (testable, no I/O). */

import type { AppRole } from "@/lib/constants";
import { isAdminRole } from "@/lib/access";
import type { RegistrationAudience } from "@/lib/registration-flows";

/** Only full admin may create students from /alunos. Not academy_limited / professor / aluno. */
export function canCreateStudentViaAdmin(roles: AppRole[]): boolean {
  return isAdminRole(roles);
}

export type AdminNewStudentPayloadInput = {
  fullName: string;
  whatsapp: string;
  academyId: string;
  belt: string;
  billingTaxId: string;
  birthDate: string;
  guardianName?: string | null;
  registrationAudience: RegistrationAudience;
  planId?: string | null;
  paymentMethod?: string | null;
  installments?: number | null;
  trainingDays?: number | null;
};

/** Body for register-student with admin_created (password omitted → edge generates secure random). */
export function buildAdminRegisterStudentBody(input: AdminNewStudentPayloadInput): Record<string, unknown> {
  const isVeteran = input.registrationAudience === "veterano";
  return {
    admin_created: true,
    full_name: input.fullName.trim(),
    whatsapp: input.whatsapp,
    academy_id: input.academyId,
    belt: input.belt || "Branca",
    billing_tax_id: input.billingTaxId,
    birth_date: input.birthDate,
    guardian_name: input.guardianName?.trim() || null,
    registration_audience: input.registrationAudience,
    plan_id: isVeteran ? null : input.planId,
    payment_method: isVeteran ? null : input.paymentMethod,
    installments:
      isVeteran || !input.paymentMethod || input.paymentMethod === "boleto"
        ? null
        : input.installments ?? 1,
    requested_training_days: isVeteran ? input.trainingDays ?? null : null,
    contract_type: "individual",
  };
}

export function adminCreatedShouldAutoApproveCadastral(): boolean {
  return true;
}

export function adminCreatedMarksPaymentPaid(): boolean {
  return false;
}
