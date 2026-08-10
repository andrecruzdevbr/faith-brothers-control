import { describe, expect, it } from "vitest";
import {
  adminCreatedMarksPaymentPaid,
  adminCreatedShouldAutoApproveCadastral,
  buildAdminRegisterStudentBody,
  canCreateStudentViaAdmin,
} from "@/lib/admin-new-student";
import {
  buildAdminCreatedRegistrationApprovedMessage,
  resolveRegistrationApprovedVariant,
} from "../../supabase/functions/_shared/whatsapp-messages.ts";
import { dispatchAdminCreatedRegistrationWhatsApp } from "../../supabase/functions/_shared/registration-whatsapp.ts";
import {
  filterPlansForRegistrationAudience,
  paymentMethodsForNewStudentPlan,
  requiresAdminPaymentConfirmation,
} from "@/lib/registration-flows";
import type { PlanOption } from "@/lib/plans";
import { vi } from "vitest";

describe("admin Novo Aluno RBAC", () => {
  it("habilita botão apenas para admin", () => {
    expect(canCreateStudentViaAdmin(["admin"])).toBe(true);
    expect(canCreateStudentViaAdmin(["admin", "aluno"])).toBe(true);
  });

  it("bloqueia academy_limited, professor e aluno", () => {
    expect(canCreateStudentViaAdmin(["academy_limited"])).toBe(false);
    expect(canCreateStudentViaAdmin(["professor"])).toBe(false);
    expect(canCreateStudentViaAdmin(["aluno"])).toBe(false);
    expect(canCreateStudentViaAdmin([])).toBe(false);
  });
});

describe("admin register payload", () => {
  it("ADM cria new_student com admin_created e catálogo/pagamento", () => {
    const body = buildAdminRegisterStudentBody({
      fullName: "Novo Iniciante",
      whatsapp: "31999999999",
      academyId: "academy-1",
      belt: "Branca",
      billingTaxId: "52998224725",
      birthDate: "2000-01-15",
      registrationAudience: "new_student",
      planId: "plan-ns-1",
      paymentMethod: "cartao_credito",
      installments: 3,
    });
    expect(body.admin_created).toBe(true);
    expect(body.registration_audience).toBe("new_student");
    expect(body.plan_id).toBe("plan-ns-1");
    expect(body.payment_method).toBe("cartao_credito");
    expect(body.installments).toBe(3);
    expect(body.requested_training_days).toBeNull();
    expect(body).not.toHaveProperty("password");
  });

  it("ADM cria veterano sem preço/plano/pagamento", () => {
    const body = buildAdminRegisterStudentBody({
      fullName: "Veterano Admin",
      whatsapp: "31988887777",
      academyId: "academy-1",
      belt: "Azul",
      billingTaxId: "52998224725",
      birthDate: "1990-05-01",
      registrationAudience: "veterano",
      planId: "should-ignore",
      paymentMethod: "boleto",
      installments: 2,
      trainingDays: 3,
    });
    expect(body.admin_created).toBe(true);
    expect(body.registration_audience).toBe("veterano");
    expect(body.plan_id).toBeNull();
    expect(body.payment_method).toBeNull();
    expect(body.installments).toBeNull();
    expect(body.requested_training_days).toBe(3);
  });

  it("aprovação cadastral automática sem marcar pagamento pago", () => {
    expect(adminCreatedShouldAutoApproveCadastral()).toBe(true);
    expect(adminCreatedMarksPaymentPaid()).toBe(false);
  });
});

describe("admin new_student catalog rules reused", () => {
  const monthlyBoleto: PlanOption = {
    id: "m1",
    name: "Mensal 2d",
    monthly_price: 199,
    training_days_per_week: 2,
    audience: "new_student",
    plan_kind: "mensal",
    duration_months: 1,
    billing_mode: "asaas_monthly",
  };
  const annualMachine: PlanOption = {
    id: "a1",
    name: "Anual 3d",
    monthly_price: 0,
    training_days_per_week: 3,
    audience: "new_student",
    plan_kind: "anual",
    duration_months: 12,
    package_total_amount: 1800,
    billing_mode: "machine_prepaid",
    allows_installments: true,
    max_installments: 12,
  };
  const veteranLeak: PlanOption = {
    id: "v1",
    name: "Veterano leak",
    monthly_price: 99,
    training_days_per_week: 2,
    audience: "veterano",
    plan_kind: "mensal",
    duration_months: 1,
    billing_mode: "asaas_monthly",
  };

  it("catálogo new_student filtra audience e preços vêm do plano (banco)", () => {
    const filtered = filterPlansForRegistrationAudience(
      [monthlyBoleto, annualMachine, veteranLeak],
      "new_student",
    );
    expect(filtered.map((p) => p.id)).toEqual(["m1", "a1"]);
    expect(filtered.every((p) => typeof p.monthly_price === "number" || p.package_total_amount != null)).toBe(
      true,
    );
  });

  it("cartão exige confirmação ADM e não libera meses no cadastro", () => {
    expect(requiresAdminPaymentConfirmation("cartao_credito")).toBe(true);
    expect(requiresAdminPaymentConfirmation("boleto")).toBe(false);
    expect(paymentMethodsForNewStudentPlan(annualMachine)).toContain("cartao_credito");
  });
});

describe("admin WhatsApp idempotente", () => {
  it("mensagem única de cadastro ADM aprovado (cartão = aguardando pagamento)", () => {
    const msg = buildAdminCreatedRegistrationApprovedMessage("Gabriel", "card");
    expect(msg).toContain("aprovado");
    expect(msg).toContain("aguardando a confirmação do pagamento");
    expect(msg).toContain("Faith Brothers, TMJ!");
    expect(msg).not.toContain("recebido com sucesso");
    expect(msg.toLowerCase()).not.toContain("pagamento confirmado");
  });

  it("variante veterano sem preço", () => {
    const variant = resolveRegistrationApprovedVariant({
      registrationAudience: "veterano",
      paymentReviewStatus: "nao_aplicavel",
    });
    expect(variant).toBe("veteran");
    const msg = buildAdminCreatedRegistrationApprovedMessage("Débora", variant, 2);
    expect(msg).toContain("frequência de treino foi registrada");
    expect(msg).toContain("definir com você o plano");
    expect(msg).not.toMatch(/R\$/);
  });

  it("dispatch usa registration_approved com sendImmediately e chave idempotente", async () => {
    const queueWhatsAppFn = vi.fn(async () => ({
      messageId: "msg-adm-1",
      sent: true,
      skipped: false,
    }));
    const result = await dispatchAdminCreatedRegistrationWhatsApp({
      supabase: {} as never,
      academyId: "academy-1",
      studentId: "student-adm-1",
      fullName: "Aluno ADM",
      whatsapp: "31985010010",
      registrationAudience: "new_student",
      paymentReviewStatus: "aguardando_conferencia",
      queueWhatsAppFn,
    });
    expect(queueWhatsAppFn).toHaveBeenCalledOnce();
    const call = queueWhatsAppFn.mock.calls[0][0];
    expect(call.messageType).toBe("registration_approved");
    expect(call.sendImmediately).toBe(true);
    expect(call.idempotencyKey).toContain("student-adm-1");
    expect(call.body).toContain("aprovado");
    expect(call.body).toContain("aguardando a confirmação do pagamento");
    expect(call.body.toLowerCase()).not.toContain("pagamento confirmado");
    expect(result.queued).toBe(true);
  });
});
