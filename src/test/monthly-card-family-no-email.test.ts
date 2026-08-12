import { describe, expect, it } from "vitest";
import type { PlanOption } from "@/lib/plans";
import {
  MONTHLY_PAYMENT_LABELS,
  MONTHLY_PAYMENT_OPTIONS,
  paymentMethodsForNewStudentPlan,
  paymentMethodsForVeteranMonthly,
  requiresAdminPaymentConfirmation,
  resolvePaymentReviewStatus,
  shouldSkipAsaasForPaymentMethod,
} from "@/lib/registration-flows";
import { shouldSkipAsaasForPrepaidMonth } from "@/lib/prepaid-contracts";
import { buildStudentPlanSituationView } from "@/lib/student-plan-situation";
import {
  buildPaymentConfirmedIdempotencyKey,
  buildRegistrationApprovedIdempotencyKey,
} from "../../supabase/functions/_shared/whatsapp-messages.ts";
import type { FamilyWizardResponsibleDraft } from "@/lib/family-wizard";
import { getLoginCredentials, whatsappToEmail } from "@/lib/whatsapp-auth";

const monthlyPlan: PlanOption = {
  id: "m2",
  name: "Mensal 2",
  monthly_price: 210,
  training_days_per_week: 2,
  audience: "new_student",
  billing_mode: "asaas_monthly",
  plan_kind: "mensal",
  duration_months: 1,
};

const trimestralPlan: PlanOption = {
  id: "t3",
  name: "Trimestral 3",
  monthly_price: 210,
  package_total_amount: 630,
  training_days_per_week: 3,
  audience: "new_student",
  billing_mode: "machine_prepaid",
  plan_kind: "trimestral",
  duration_months: 3,
};

describe("monthly boleto XOR cartão", () => {
  it("new_student mensal offers only Boleto and Cartão", () => {
    const methods = paymentMethodsForNewStudentPlan(monthlyPlan);
    expect(methods).toEqual(["boleto", "cartao_credito"]);
    expect(methods).toHaveLength(2);
    expect(MONTHLY_PAYMENT_LABELS.boleto).toBe("Boleto");
    expect(MONTHLY_PAYMENT_LABELS.cartao_credito.toLowerCase()).toContain("cartão");
  });

  it("only one monthly option is selectable at a time (exclusive set)", () => {
    expect(MONTHLY_PAYMENT_OPTIONS).toEqual(["boleto", "cartao_credito"]);
    expect(new Set(MONTHLY_PAYMENT_OPTIONS).size).toBe(2);
  });

  it("new_student mensal boleto keeps Asaas path (no machine confirm)", () => {
    expect(requiresAdminPaymentConfirmation("boleto")).toBe(false);
    expect(resolvePaymentReviewStatus({ paymentMethod: "boleto" })).toBe("nao_aplicavel");
    expect(shouldSkipAsaasForPaymentMethod("boleto")).toBe(false);
    expect(
      shouldSkipAsaasForPrepaidMonth({
        billingMode: "asaas_monthly",
        hasPaidCoverageForMonth: false,
        paymentMethod: "boleto",
      }).skip,
    ).toBe(false);
  });

  it("new_student mensal cartão does not generate boleto and starts unpaid", () => {
    expect(requiresAdminPaymentConfirmation("cartao_credito")).toBe(true);
    expect(resolvePaymentReviewStatus({ paymentMethod: "cartao_credito" })).toBe(
      "aguardando_conferencia",
    );
    expect(shouldSkipAsaasForPaymentMethod("cartao_credito")).toBe(true);
    expect(
      shouldSkipAsaasForPrepaidMonth({
        billingMode: "asaas_monthly",
        hasPaidCoverageForMonth: false,
        paymentMethod: "cartao_credito",
      }),
    ).toEqual({ skip: true, reason: "skipped_machine_payment_method" });
  });

  it("veteran mensal offers Boleto and Cartão", () => {
    expect(paymentMethodsForVeteranMonthly()).toEqual(["boleto", "cartao_credito"]);
  });

  it("prepaid trimestral still excludes boleto", () => {
    expect(paymentMethodsForNewStudentPlan(trimestralPlan)).not.toContain("boleto");
    expect(paymentMethodsForNewStudentPlan(trimestralPlan)).toContain("cartao_credito");
  });

  it("cartão exige confirmação ADM; cobertura só após confirmação", () => {
    const awaiting = buildStudentPlanSituationView({
      status: "pendente_aprovacao",
      approved_at: "2026-08-11T12:00:00Z",
      payment_review_status: "aguardando_conferencia",
      registration_audience: "new_student",
      requested_payment_method: "cartao_credito",
      plan: monthlyPlan,
      coverageMonths: [],
    });
    expect(awaiting.statusLabel).toBe("Aguardando confirmação do pagamento");
    expect(awaiting.paymentMethodLabel).toMatch(/cartão/i);
    expect(awaiting.showCoverageAsPaid).toBe(false);
    expect(awaiting.coverage).toHaveLength(0);
    expect(awaiting.monthsEmptyLabel?.toLowerCase()).toContain("nenhum");

    const paid = buildStudentPlanSituationView({
      status: "ativo",
      approved_at: "2026-08-11T12:00:00Z",
      payment_review_status: "confirmado",
      registration_audience: "new_student",
      requested_payment_method: "cartao_credito",
      plan: monthlyPlan,
      contract: {
        starts_on: "2026-08-11",
        ends_on: "2026-08-31",
        weekly_frequency: 2,
        total_amount: 210,
        payment_method: "cartao_credito",
        payment_status: "pago",
        contract_status: "ativo",
        duration_months: 1,
      },
      coverageMonths: [{ reference_month: "2026-08-01", status: "pago" }],
    });
    expect(paid.statusLabel).toBe("Ativo");
    expect(paid.coverage).toHaveLength(1);
    expect(paid.paymentMethodLabel).toMatch(/cartão/i);
  });

  it("registration_approved and payment_confirmed remain separate idempotent keys", () => {
    const sid = "student-1";
    const approved = buildRegistrationApprovedIdempotencyKey(sid);
    const paid = buildPaymentConfirmedIdempotencyKey("contract-1");
    expect(approved).toContain("approved");
    expect(paid).toContain("payment_confirmed");
    expect(approved).not.toEqual(paid);
    expect(approved).not.toContain("payment_confirmed");
  });
});

describe("Family without email + WhatsApp auth", () => {
  it("responsible draft type has no email field", () => {
    const draft: FamilyWizardResponsibleDraft = {
      fullName: "Responsável",
      whatsapp: "31981044156",
      birthDate: "1990-01-01",
      billingTaxId: "52998224725",
      trains: false,
      belt: "Branca",
      degrees: 0,
      trainingDays: 3,
      guardianName: "",
      familyName: "",
      password: "senha12345",
      confirmPassword: "senha12345",
    };
    expect(draft).not.toHaveProperty("email");
  });

  it("individual and family login use WhatsApp → synthetic email internally", () => {
    const { email, password } = getLoginCredentials("31981044156", "senha-segura");
    expect(email).toBe(whatsappToEmail("31981044156"));
    expect(email).toMatch(/@wa\.faithbrothers\.app$/);
    expect(email).not.toContain("exemplo.com");
    expect(password).toBe("senha-segura");
  });
});
