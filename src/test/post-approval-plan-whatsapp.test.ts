import { describe, expect, it } from "vitest";
import {
  FAITH_BROTHERS_WHATSAPP_SIGNATURE,
  buildContractApprovedIdempotencyKey,
  buildContractApprovedMessage,
  buildNewStudentCardRegistrationApprovedMessage,
  buildNewStudentRegistrationApprovedMessage,
  buildPaymentConfirmedIdempotencyKey,
  buildRegistrationApprovedIdempotencyKey,
  buildRegistrationApprovedMessage,
  buildVeteranRegistrationApprovedMessage,
  resolveRegistrationApprovedVariant,
} from "../../supabase/functions/_shared/whatsapp-messages.ts";
import {
  buildStudentPlanSituationView,
  containsTechnicalStatusLeak,
  expectedCoverageCount,
  friendlyBillingStatusLabel,
} from "@/lib/student-plan-situation";
import { buildCoverageMonths } from "@/lib/prepaid-contracts";

describe("two distinct WA events: registration_approved vs payment_confirmed", () => {
  it("aprovação NEW_STUDENT cartão gera registration_approved copy e NÃO payment_confirmed", () => {
    const body = buildRegistrationApprovedMessage("Gabriel", "card");
    expect(body).toBe(buildNewStudentCardRegistrationApprovedMessage("Gabriel"));
    expect(body).toContain("aprovado");
    expect(body).toContain("aguardando a confirmação do pagamento");
    expect(body).toContain("aplicativo");
    expect(body).toContain(FAITH_BROTHERS_WHATSAPP_SIGNATURE);
    expect(body.toLowerCase()).not.toContain("pagamento confirmado");
    expect(body.toLowerCase()).not.toContain("meses liberados");
    expect(body.toLowerCase()).not.toContain("r$");
  });

  it("aprovação NÃO usa chave de payment_confirmed", () => {
    const studentId = "stu-1";
    const contractId = "c-1";
    expect(buildRegistrationApprovedIdempotencyKey(studentId)).toBe(
      `registration:${studentId}:approved`,
    );
    expect(buildPaymentConfirmedIdempotencyKey(contractId)).toBe(
      `contract_approved:${contractId}:payment_confirmed`,
    );
    expect(buildRegistrationApprovedIdempotencyKey(studentId)).not.toBe(
      buildPaymentConfirmedIdempotencyKey(contractId),
    );
  });

  it("pagamento gera payment_confirmed copy distinta", () => {
    const body = buildContractApprovedMessage({
      fullName: "Gabriel",
      planKindLabel: "Trimestral",
      trainingDays: 3,
      startsOn: "2026-08-01",
      endsOn: "2026-10-31",
    });
    expect(body).toContain("Pagamento confirmado!");
    expect(body).toContain("Trimestral");
    expect(body).toContain("3 dias por semana");
    expect(body).toContain("Período liberado:");
    expect(body).toContain("2026-08-01 até 2026-10-31");
    expect(body).toContain("meses liberados pelo aplicativo");
    expect(body).toContain(FAITH_BROTHERS_WHATSAPP_SIGNATURE);
    expect(body).not.toContain("aguardando a confirmação do pagamento");
  });

  it("idempotência: aprovar/confirmar duas vezes reutiliza a mesma chave do evento", () => {
    const stu = "stu-x";
    const c = "contract-x";
    expect(buildRegistrationApprovedIdempotencyKey(stu)).toBe(
      buildRegistrationApprovedIdempotencyKey(stu),
    );
    expect(buildContractApprovedIdempotencyKey(c, "payment_confirmed")).toBe(
      buildPaymentConfirmedIdempotencyKey(c),
    );
  });

  it("Veterano aprovado: frequência registrada, sem preço, sem payment_confirmed", () => {
    expect(resolveRegistrationApprovedVariant({ registrationAudience: "veterano" })).toBe(
      "veteran",
    );
    const body = buildVeteranRegistrationApprovedMessage("Debora", 3);
    expect(body).toContain("aprovado");
    expect(body).toContain("frequência de treino foi registrada");
    expect(body).toContain("definir com você o plano");
    expect(body).toContain("aplicativo");
    expect(body).toContain(FAITH_BROTHERS_WHATSAPP_SIGNATURE);
    expect(body).not.toContain("R$");
    expect(body.toLowerCase()).not.toContain("pagamento confirmado");
  });

  it("boleto approval still registration_approved without claiming paid", () => {
    const body = buildNewStudentRegistrationApprovedMessage("Ana");
    expect(body).toContain("aprovado");
    expect(body.toLowerCase()).not.toContain("pagamento confirmado");
  });
});

describe("student plan situation after approval vs payment", () => {
  it("após aprovação cartão: cadastro aprovado, financeiro aguardando, meses nenhum", () => {
    const view = buildStudentPlanSituationView({
      status: "pendente_aprovacao",
      approved_at: "2026-08-09T12:00:00Z",
      payment_review_status: "aguardando_conferencia",
      registration_audience: "new_student",
      requested_payment_method: "cartao_credito",
      plan: {
        id: "p1",
        name: "Trimestral 3",
        plan_kind: "trimestral",
        training_days_per_week: 3,
        billing_mode: "machine_prepaid",
        package_total_amount: 630,
        duration_months: 3,
        monthly_price: 210,
      },
      coverageMonths: [],
    });
    expect(view.registrationLabel).toBe("Aprovado");
    expect(view.planLabel).toBe("Trimestral");
    expect(view.frequencyLabel).toContain("3 dias");
    expect(view.financialLabel?.toLowerCase()).toContain("aguardando confirmação");
    expect(view.statusLabel).toBe("Aguardando confirmação do pagamento");
    expect(view.showCoverageAsPaid).toBe(false);
    expect(view.coverage).toHaveLength(0);
    expect(view.monthsEmptyLabel?.toLowerCase()).toContain("nenhum");
    expect(view.paymentLabel).not.toBe("Confirmado");
    expect(containsTechnicalStatusLeak(view.statusLabel)).toBe(false);
  });

  it("meses só aparecem após confirmação financeira", () => {
    for (const [kind, months] of [
      ["trimestral", 3],
      ["semestral", 6],
      ["anual", 12],
    ] as const) {
      const refs = buildCoverageMonths("2026-08-15", months);
      expect(expectedCoverageCount(months)).toBe(months);
      const view = buildStudentPlanSituationView({
        status: "ativo",
        approved_at: "2026-08-09T12:00:00Z",
        payment_review_status: "confirmado",
        registration_audience: "new_student",
        plan: {
          id: `p-${kind}`,
          plan_kind: kind,
          training_days_per_week: 3,
          billing_mode: "machine_prepaid",
          package_total_amount: 1000,
          duration_months: months,
          monthly_price: 100,
        },
        contract: {
          starts_on: "2026-08-15",
          ends_on: "2026-11-14",
          weekly_frequency: 3,
          total_amount: 1000,
          payment_method: "cartao_credito",
          payment_status: "pago",
          contract_status: "ativo",
          duration_months: months,
        },
        coverageMonths: refs.map((reference_month) => ({
          reference_month,
          status: "pago",
        })),
      });
      expect(view.registrationLabel).toBe("Aprovado");
      expect(view.coverage).toHaveLength(months);
      expect(view.paymentLabel).toBe("Confirmado");
      expect(view.financialLabel).toBe("Confirmado");
      expect(view.statusLabel).toBe("Ativo");
      expect(view.monthsEmptyLabel).toBeNull();
      expect(view.periodLabel).toContain("2026-08-15");
      expect(view.planLabel.toLowerCase()).toContain(kind === "trimestral" ? "trimestral" : kind === "semestral" ? "semestral" : "anual");
    }
  });

  it("mensal shows friendly billing status", () => {
    expect(friendlyBillingStatusLabel("pendente")).toBe("Aguardando pagamento");
    expect(friendlyBillingStatusLabel("pago")).toBe("Pago");
    expect(friendlyBillingStatusLabel("vencido")).toBe("Pagamento vencido");
  });

  it("veteran aprovado mostra aguardando definição sem preço fake", () => {
    const view = buildStudentPlanSituationView({
      status: "pendente_aprovacao",
      approved_at: "2026-08-10T01:00:00Z",
      payment_review_status: "nao_aplicavel",
      registration_audience: "veterano",
      requested_training_days: 5,
      plan: null,
    });
    expect(view.registrationLabel).toBe("Aprovado");
    expect(view.statusLabel).toBe("Aguardando definição do plano");
    expect(view.planLabel).toBe("Aguardando definição");
    expect(view.frequencyCaption).toBe("Frequência solicitada");
    expect(view.paymentLabel).toBe("Aguardando definição");
    expect(view.financialLabel).toBe("Aguardando definição");
    expect(view.amountLabel).toBeNull();
    expect(view.frequencyLabel).toContain("5 dias");
    expect(view.coverage).toHaveLength(0);
    expect(containsTechnicalStatusLeak(JSON.stringify(view))).toBe(false);
  });

  it("frequency 1/2/3/5 appears correctly", () => {
    for (const d of [1, 2, 3, 5]) {
      const view = buildStudentPlanSituationView({
        status: "ativo",
        approved_at: "x",
        registration_audience: "new_student",
        plan: {
          id: "m",
          plan_kind: "mensal",
          training_days_per_week: d,
          billing_mode: "asaas_monthly",
          monthly_price: 210,
        },
        latestBillingStatus: "pago",
      });
      expect(view.frequencyLabel).toContain(d === 1 ? "1 dia" : `${d} dias`);
    }
  });
});
