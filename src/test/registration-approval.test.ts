import { describe, expect, it } from "vitest";
import {
  annualMonthsAfterPaymentConfirm,
  cadastralApproveReleasesMonths,
  getAdminStudentStatusLabel,
  getPendingAdminPrimaryAction,
  shouldShowApproveRegistrationButton,
  shouldShowMachinePaymentButton,
  shouldShowRejectButton,
} from "@/lib/registration-approval";
import { buildCoverageMonths } from "@/lib/prepaid-contracts";

const GABRIEL = {
  id: "96bd42eb-ab0c-4f4b-9c43-1ce9734718be",
  full_name: "Gabriel Cruz",
  status: "pendente_aprovacao" as const,
  payment_review_status: "aguardando_conferencia",
  registration_audience: "new_student",
  approved_at: null as string | null,
  plan_kind: "anual",
  duration_months: 12,
};

describe("separação aprovação cadastral vs pagamento", () => {
  it("cadastro pendente possui Aprovar cadastro e não exige pagamento", () => {
    expect(shouldShowApproveRegistrationButton(GABRIEL)).toBe(true);
    expect(shouldShowRejectButton(GABRIEL)).toBe(true);
    expect(shouldShowMachinePaymentButton(GABRIEL)).toBe(false);
    expect(getPendingAdminPrimaryAction(GABRIEL)).toBe("approve_registration");
    expect(getAdminStudentStatusLabel(GABRIEL)).toBe("Pendente de aprovação");
  });

  it("cartão aprovado cadastralmente continua unpaid e sem meses", () => {
    const afterCadastro = {
      ...GABRIEL,
      approved_at: "2026-08-09T15:00:00.000Z",
    };
    expect(shouldShowApproveRegistrationButton(afterCadastro)).toBe(false);
    expect(shouldShowMachinePaymentButton(afterCadastro)).toBe(true);
    expect(getAdminStudentStatusLabel(afterCadastro)).toBe("Aprovado — aguardando pagamento");
    expect(cadastralApproveReleasesMonths()).toBe(false);
    expect(buildCoverageMonths("2026-08-09", 0)).toHaveLength(0);
  });

  it("anual libera 12 meses somente após confirmação financeira", () => {
    expect(annualMonthsAfterPaymentConfirm(12)).toBe(12);
    expect(buildCoverageMonths("2026-08-15", 12)).toHaveLength(12);
  });

  it("mensal/Asaas não usa botão indevido da maquininha", () => {
    const monthly = {
      status: "pendente_aprovacao",
      approved_at: null,
      payment_review_status: "nao_aplicavel",
      registration_audience: "new_student",
    };
    expect(shouldShowMachinePaymentButton(monthly)).toBe(false);
    expect(shouldShowApproveRegistrationButton(monthly)).toBe(true);
    const after = { ...monthly, approved_at: "2026-08-09T15:00:00.000Z", status: "ativo" };
    expect(shouldShowMachinePaymentButton(after)).toBe(false);
    expect(getAdminStudentStatusLabel(after)).toBe("Ativo");
  });

  it("veterano pode ser aprovado sem plano financeiro definido", () => {
    const veteran = {
      status: "pendente_aprovacao",
      approved_at: null,
      payment_review_status: "nao_aplicavel",
      registration_audience: "veterano",
      billing_period_status: "nao_aplicavel",
    };
    expect(shouldShowApproveRegistrationButton(veteran)).toBe(true);
    expect(shouldShowMachinePaymentButton(veteran)).toBe(false);
    const after = {
      ...veteran,
      approved_at: "2026-08-09T15:00:00.000Z",
      billing_period_status: "aguardando_escolha",
    };
    expect(getPendingAdminPrimaryAction(after)).toBe("define_veteran_modality");
    expect(getAdminStudentStatusLabel(after)).toBe("Aprovado — aguardando definição do plano");
  });

  it("familiar prepaid preserva sequência cadastro → pagamento", () => {
    const familyLead = {
      status: "pendente_aprovacao",
      approved_at: null,
      payment_review_status: "aguardando_conferencia",
      pending_family_group_id: "fam-1",
    };
    expect(shouldShowApproveRegistrationButton(familyLead)).toBe(true);
    expect(shouldShowMachinePaymentButton(familyLead)).toBe(false);
    const after = { ...familyLead, approved_at: "2026-08-09T15:00:00.000Z" };
    expect(shouldShowMachinePaymentButton(after)).toBe(true);
  });

  it("Gabriel Cruz de referência não é apagado e não recebe meses antes do pagamento", () => {
    expect(GABRIEL.id).toBe("96bd42eb-ab0c-4f4b-9c43-1ce9734718be");
    expect(GABRIEL.full_name).toBe("Gabriel Cruz");
    expect(cadastralApproveReleasesMonths()).toBe(false);
    expect(GABRIEL.approved_at).toBeNull();
    expect(GABRIEL.duration_months).toBe(12);
  });
});
