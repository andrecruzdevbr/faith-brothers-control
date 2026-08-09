/** Pure helpers: cadastral approval vs financial confirmation (no I/O). */

export type RegistrationApprovalSnapshot = {
  status?: string | null;
  approved_at?: string | null;
  payment_review_status?: string | null;
  registration_audience?: string | null;
  billing_period_status?: string | null;
  pending_family_group_id?: string | null;
};

export function isRegistrationApproved(student: RegistrationApprovalSnapshot): boolean {
  return Boolean(student.approved_at);
}

export function needsMachinePaymentConfirm(student: RegistrationApprovalSnapshot): boolean {
  return student.payment_review_status === "aguardando_conferencia";
}

export function needsVeteranModality(student: RegistrationApprovalSnapshot): boolean {
  return (
    student.registration_audience === "veterano" &&
    student.billing_period_status === "aguardando_escolha"
  );
}

/** Admin list / review labels without inventing a new DB enum. */
export function getAdminStudentStatusLabel(student: RegistrationApprovalSnapshot): string {
  if (student.status === "rejeitado") return "Rejeitado";
  if (student.status === "ativo") return "Ativo";
  if (student.status === "inativo") return "Inativo";
  if (student.status !== "pendente_aprovacao") {
    return student.status ?? "—";
  }
  if (!isRegistrationApproved(student)) {
    return "Pendente de aprovação";
  }
  if (needsMachinePaymentConfirm(student)) {
    return "Aprovado — aguardando pagamento";
  }
  if (needsVeteranModality(student)) {
    return "Aprovado — aguardando definição do plano";
  }
  return "Aprovado — aguardando fluxo financeiro";
}

export type PendingAdminAction =
  | "approve_registration"
  | "confirm_payment"
  | "define_veteran_modality"
  | "none";

export function getPendingAdminPrimaryAction(
  student: RegistrationApprovalSnapshot,
): PendingAdminAction {
  if (student.status !== "pendente_aprovacao") return "none";
  if (!isRegistrationApproved(student)) return "approve_registration";
  if (needsMachinePaymentConfirm(student)) return "confirm_payment";
  if (needsVeteranModality(student)) return "define_veteran_modality";
  return "none";
}

/** Cadastral approve must not imply paid months. */
export function cadastralApproveReleasesMonths(): false {
  return false;
}

export function annualMonthsAfterPaymentConfirm(durationMonths: number): number {
  return durationMonths > 0 ? durationMonths : 0;
}

export function shouldShowMachinePaymentButton(student: RegistrationApprovalSnapshot): boolean {
  return (
    student.status === "pendente_aprovacao" &&
    isRegistrationApproved(student) &&
    needsMachinePaymentConfirm(student)
  );
}

export function shouldShowApproveRegistrationButton(student: RegistrationApprovalSnapshot): boolean {
  return student.status === "pendente_aprovacao" && !isRegistrationApproved(student);
}

export function shouldShowRejectButton(student: RegistrationApprovalSnapshot): boolean {
  return student.status === "pendente_aprovacao" && !isRegistrationApproved(student);
}
