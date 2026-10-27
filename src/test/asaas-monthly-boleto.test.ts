import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSendableBoletoUrl } from "../../supabase/functions/_shared/billing-boleto.ts";
import {
  decideBillingGenerationAction,
  shouldCreateAsaasPayment,
  pickExistingAsaasPayment,
} from "../../supabase/functions/_shared/asaas-billing.ts";
import {
  billingStatusTransition,
  buildBillingUpdates,
} from "../../supabase/functions/_shared/asaas-webhook.ts";
import {
  DEFAULT_BOLETO_DUE_DAY,
  DEFAULT_BOLETO_ISSUE_DAY,
  resolveDefaultBillingPeriod,
  shouldSkipBeforeIssueDay,
  summarizeBillingProcessed,
} from "../../supabase/functions/_shared/billing-settings.ts";
import {
  ASAAS_BOLETO_BILLING_TYPE,
  BOLETO_FINE_PERCENT,
  BOLETO_INTEREST_PERCENT_PER_MONTH,
  buildAsaasBoletoPaymentPayload,
  buildBillingIssuedIdempotencyKey,
  buildBillingOverdueReminderIdempotencyKey,
  buildMonthlyBoletoWhatsAppMessage,
  calculateBoletoLateCharges,
  isWeekendIsoDate,
  preferBankSlipUrl,
  resolveMonthlyBillingWhatsAppRecipient,
  shouldDispatchBillingWhatsApp,
  shouldGenerateMonthlyBoleto,
  skipReasonForNonBoletoPaymentMethod,
} from "../../supabase/functions/_shared/asaas-monthly-boleto.ts";

const ROOT = resolve(process.cwd());

describe("monthly boleto calendar — day 12 generate, day 15 due", () => {
  it("generates on day 12 for the current month with due date 15", () => {
    expect(DEFAULT_BOLETO_ISSUE_DAY).toBe(12);
    expect(DEFAULT_BOLETO_DUE_DAY).toBe(15);
    expect(shouldSkipBeforeIssueDay(12, 12, false)).toBe(false);

    const period = resolveDefaultBillingPeriod(
      new Date("2026-08-12T08:00:00-03:00"),
      DEFAULT_BOLETO_DUE_DAY,
      DEFAULT_BOLETO_ISSUE_DAY,
    );
    expect(period.issueDate).toBe("2026-08-12");
    expect(period.dueDate).toBe("2026-08-15");
    expect(period.referenceMonth).toBe("2026-08-01");
  });

  it("keeps due date on day 15 of the same month", () => {
    const onDue = resolveDefaultBillingPeriod(
      new Date("2026-08-15T12:00:00-03:00"),
      15,
      12,
    );
    expect(onDue.dueDate).toBe("2026-08-15");
    expect(onDue.referenceMonth).toBe("2026-08-01");
  });

  it("treats day 16 as overdue for late-charge calculation", () => {
    const charges = calculateBoletoLateCharges({
      principal: 200,
      dueDate: "2026-08-15",
      asOfDate: "2026-08-16",
    });
    expect(charges.overdue).toBe(true);
    expect(charges.daysLate).toBe(1);
  });
});

describe("Asaas boleto payload", () => {
  it("creates BOLETO charges with 2% fine and 1% monthly interest", () => {
    const payload = buildAsaasBoletoPaymentPayload({
      customerId: "cus_1",
      value: 200,
      dueDate: "2026-08-15",
      description: "Faith Brothers - Plano 1 dia - 2026-08-01",
      externalReference: "student-1:2026-08-01",
    });
    expect(payload.billingType).toBe(ASAAS_BOLETO_BILLING_TYPE);
    expect(payload.billingType).toBe("BOLETO");
    expect(payload.fine).toEqual({ value: BOLETO_FINE_PERCENT });
    expect(payload.interest).toEqual({ value: BOLETO_INTEREST_PERCENT_PER_MONTH });
    expect(payload.fine.value).toBe(2);
    expect(payload.interest.value).toBe(1);
    expect(payload.dueDate).toBe("2026-08-15");
  });

  it("prefers bankSlipUrl over invoiceUrl for WhatsApp", () => {
    expect(
      preferBankSlipUrl({
        id: "pay_1",
        bankSlipUrl: "https://www.asaas.com/b/pdf/abc",
        invoiceUrl: "https://www.asaas.com/i/abc",
      }),
    ).toBe("https://www.asaas.com/b/pdf/abc");
  });

  it("does not dispatch WhatsApp before a successful Asaas payment id", () => {
    expect(shouldDispatchBillingWhatsApp({ sendWhatsApp: true, asaasPaymentId: null })).toBe(false);
    expect(shouldDispatchBillingWhatsApp({ sendWhatsApp: true, asaasPaymentId: "pay_1" })).toBe(true);
    expect(shouldDispatchBillingWhatsApp({ sendWhatsApp: false, asaasPaymentId: "pay_1" })).toBe(false);
  });

  it("puts the bankSlipUrl in the automatic WhatsApp message", () => {
    const msg = buildMonthlyBoletoWhatsAppMessage({
      academyName: "Faith Brothers",
      studentName: "Aluno Homolog",
      planName: "Plano 1 dia por semana",
      amount: 5,
      dueDate: "2026-10-29",
      bankSlipUrl: "https://www.asaas.com/b/pdf/abc",
      financeContact: "Ramon",
      financeWhatsapp: "31987540515",
    });
    expect(msg).toContain("Boleto: https://www.asaas.com/b/pdf/abc");
    expect(msg).not.toContain("Boleto/PIX");
    expect(msg).toContain("29/10/2026");
  });
});

describe("late charges — 2% fine and 1% monthly interest", () => {
  it("does not add charges on the due date", () => {
    expect(
      calculateBoletoLateCharges({
        principal: 200,
        dueDate: "2026-08-15",
        asOfDate: "2026-08-15",
      }),
    ).toEqual({ overdue: false, daysLate: 0, fine: 0, interest: 0, total: 200 });
  });

  it("applies unique 2% fine on day 16", () => {
    const charges = calculateBoletoLateCharges({
      principal: 200,
      dueDate: "2026-08-15",
      asOfDate: "2026-08-16",
    });
    expect(charges.fine).toBe(4);
    expect(charges.interest).toBe(0.07);
    expect(charges.total).toBe(204.07);
  });

  it("accrues 1% per month proportional to days late", () => {
    const thirtyDays = calculateBoletoLateCharges({
      principal: 200,
      dueDate: "2026-08-15",
      asOfDate: "2026-09-14",
    });
    expect(thirtyDays.daysLate).toBe(30);
    expect(thirtyDays.fine).toBe(4);
    expect(thirtyDays.interest).toBe(2);
    expect(thirtyDays.total).toBe(206);
  });
});

describe("non-business due dates stay on day 15 for Asaas", () => {
  it("keeps contractual due date when day 15 is Saturday", () => {
    expect(isWeekendIsoDate("2026-08-15")).toBe(true);
    const payload = buildAsaasBoletoPaymentPayload({
      customerId: "cus_1",
      value: 180,
      dueDate: "2026-08-15",
      description: "mensalidade",
      externalReference: "s:2026-08-01",
    });
    expect(payload.dueDate).toBe("2026-08-15");
  });

  it("keeps contractual due date when day 15 is Sunday", () => {
    expect(isWeekendIsoDate("2026-11-15")).toBe(true);
    expect(
      buildAsaasBoletoPaymentPayload({
        customerId: "cus_1",
        value: 180,
        dueDate: "2026-11-15",
        description: "mensalidade",
        externalReference: "s:2026-11-01",
      }).dueDate,
    ).toBe("2026-11-15");
  });
});

describe("already paid and duplicate cron", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("does not recreate a paid billing", () => {
    expect(
      decideBillingGenerationAction(
        { id: "b-paid", status: "pago", asaas_payment_id: "pay_paid", updated_at: now.toISOString() },
        now,
      ),
    ).toEqual({ action: "already_exists", billingId: "b-paid" });
  });

  it("blocks a second Asaas create when the payment already exists", () => {
    const existing = pickExistingAsaasPayment({ data: [{ id: "pay_existing" }] });
    expect(shouldCreateAsaasPayment(existing)).toBe(false);
    expect(
      decideBillingGenerationAction(
        { id: "b2", status: "gerado", asaas_payment_id: "pay_existing", updated_at: now.toISOString() },
        now,
      ).action,
    ).toBe("already_exists");
  });
});

describe("Asaas API and WhatsApp failure handling", () => {
  it("counts Asaas create failures as errors without a second charge", () => {
    const summary = summarizeBillingProcessed([
      { studentId: "1", status: "failed", stage: "create_asaas_payment", error: "Asaas [500]" },
    ]);
    expect(summary.errors).toBe(1);
    expect(summary.created).toBe(0);
  });

  it("keeps the billing generated when WhatsApp fails after Asaas success", () => {
    const summary = summarizeBillingProcessed([
      { studentId: "1", status: "generated" },
      { studentId: "1", status: "whatsapp_failed" },
    ]);
    expect(summary.created).toBe(1);
    expect(summary.whatsappSkipped).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("blocks sandbox boleto links from production WhatsApp", () => {
    expect(assertSendableBoletoUrl("https://sandbox.asaas.com/b/pdf/abc")).toEqual({
      ok: false,
      reason: "sandbox_boleto",
    });
  });
});

describe("family responsible and other payment methods", () => {
  it("sends the family boleto to the financial responsible, not a sibling", () => {
    const siblingPhone = "5531999000002";
    const memberPhone = "5531999000001";
    const responsiblePhone = "5531981044156";
    const resolved = resolveMonthlyBillingWhatsAppRecipient({
      studentId: "member-a",
      studentWhatsapp: memberPhone,
      responsibleStudentId: "resp",
      responsiblePhone,
    });
    expect(resolved.source).toBe("family_responsible");
    expect(resolved.recipient).toBe(responsiblePhone);
    expect(resolved.recipient).not.toBe(siblingPhone);
    expect(resolved.recipient).not.toBe(memberPhone);
  });

  it("skips students who chose card, pix or cash instead of boleto", () => {
    expect(shouldGenerateMonthlyBoleto("boleto")).toBe(true);
    expect(shouldGenerateMonthlyBoleto(null)).toBe(true);
    expect(shouldGenerateMonthlyBoleto("")).toBe(true);
    expect(shouldGenerateMonthlyBoleto("pix")).toBe(false);
    expect(shouldGenerateMonthlyBoleto("cartao_credito")).toBe(false);
    expect(shouldGenerateMonthlyBoleto("cartao_debito")).toBe(false);
    expect(shouldGenerateMonthlyBoleto("dinheiro")).toBe(false);
    expect(skipReasonForNonBoletoPaymentMethod("pix")).toBe("skipped_non_boleto_payment_method");
    expect(skipReasonForNonBoletoPaymentMethod("boleto")).toBeNull();
  });
});

describe("webhook vs local finance for late payment", () => {
  it("marks the ledger paid without changing the original principal", () => {
    expect(billingStatusTransition("gerado", "PAYMENT_RECEIVED")).toBe("pago");
    expect(buildBillingUpdates("PAYMENT_RECEIVED", "2026-08-16T12:00:00.000Z")).toEqual({
      status: "pago",
      paid_at: "2026-08-16T12:00:00.000Z",
    });
    expect(buildBillingUpdates("PAYMENT_RECEIVED", "2026-08-16T12:00:00.000Z")).not.toHaveProperty("amount");
  });
});

describe("wiring — cron day 12 and generate-monthly-billings payload", () => {
  it("schedules GitHub Actions at 08:00 America/Sao_Paulo on day 12", () => {
    const cron = readFileSync(resolve(ROOT, ".github/workflows/billing-cron.yml"), "utf8");
    expect(cron).toContain('cron: "0 11 12 * *"');
    expect(cron).toContain("GitHub Actions interpreta `cron:` em UTC");
    expect(cron).toContain("11:00 UTC do dia 12 = 08:00 America/Sao_Paulo");
    expect(cron).toContain('DAY}" = "12"');
    expect(cron).toContain("wojqjxtaqjasnfhbotxi");
    expect(cron).toContain("Recusando: BASE_URL aponta ao staging");
    expect(cron).toContain("group: billing-cron");
    expect(cron).toContain("cancel-in-progress: false");
    expect(cron).not.toContain('cron: "0 11 10 * *"');
    expect(cron).not.toMatch(/functions\/v1\/.*apbksfaztfkxshxffpik/);
  });

  it("uses the boleto payload builder instead of UNDEFINED billingType", () => {
    const source = readFileSync(
      resolve(ROOT, "supabase/functions/generate-monthly-billings/index.ts"),
      "utf8",
    );
    expect(source).toContain("buildAsaasBoletoPaymentPayload");
    expect(source).not.toContain('billingType: "UNDEFINED"');
    expect(source).toContain("shouldDispatchBillingWhatsApp");
    expect(source).toContain("preferBankSlipUrl");
    expect(source).toContain("buildBillingIssuedIdempotencyKey");
    expect(source).toContain("idempotencyKey: buildBillingIssuedIdempotencyKey(params.billingId)");
    expect(source).toContain("Idempotency-Key");
    expect(source).toContain("buildAsaasPaymentIdempotencyKey");
    expect(source).toContain("prepaid_cron_skip_reason indisponivel");
  });

  it("uses a stable unique key per billing issue event", () => {
    expect(buildBillingIssuedIdempotencyKey("bill-1")).toBe("billing:bill-1:issued");
    expect(buildBillingOverdueReminderIdempotencyKey("bill-1")).toBe(
      "billing:bill-1:overdue_reminder",
    );
    expect(buildBillingIssuedIdempotencyKey("bill-1")).not.toBe(
      buildBillingOverdueReminderIdempotencyKey("bill-1"),
    );
  });

  it("keeps workflow_dispatch auth_check from creating Asaas charges", () => {
    const cron = readFileSync(resolve(ROOT, ".github/workflows/billing-cron.yml"), "utf8");
    const authBlock = cron.split('= "auth_check" ]; then')[1]?.split("elif")[0] ?? "";
    expect(authBlock).toContain("Nenhuma Edge Function chamada");
    expect(authBlock).toContain("Nao gera cobranca");
    expect(authBlock).not.toContain("generate-monthly-billings");
    expect(authBlock).not.toContain("send-billing-whatsapp");
    expect(authBlock).not.toContain("curl");
    expect(authBlock).not.toContain("force");
    expect(cron).not.toContain("ced46b69-4293-48dd-b04f-300bb835150f");
    expect(cron).toContain('default: "auth_check"');
    expect(cron).toContain("wojqjxtaqjasnfhbotxi");
    expect(cron).toContain("apbksfaztfkxshxffpik");
  });

  it("schedules day 19 as overdue reminder, not a new charge", () => {
    const cron = readFileSync(resolve(ROOT, ".github/workflows/billing-cron.yml"), "utf8");
    expect(cron).toContain('cron: "0 11 19 * *"');
    expect(cron).toContain('DAY}" = "19"');
    expect(cron).toContain('JOB="overdue"');
    expect(cron).toContain("/send-billing-whatsapp");
    expect(cron).toContain('{"scope":"overdue_reminder"}');
    expect(cron).toContain("/generate-monthly-billings");
  });

  it("sends overdue reminders to the family financial responsible", () => {
    const source = readFileSync(
      resolve(ROOT, "supabase/functions/send-billing-whatsapp/index.ts"),
      "utf8",
    );
    expect(source).toContain("resolveMonthlyBillingWhatsAppRecipient");
    expect(source).toContain("loadFamilyResponsibleMap");
    expect(source).toContain("recipient: billingRecipient");
    expect(source).not.toContain("recipient: student?.whatsapp ?? \"\"");
    expect(source).toContain("buildBillingIssuedIdempotencyKey");
    expect(source).toContain("buildBillingOverdueReminderIdempotencyKey");
  });
});

describe("controlled day-12 monthly run (mocks only)", () => {
  it("walks generate → send → skip paid/duplicate → keep principal on late pay", () => {
    const now = new Date("2026-08-12T08:00:00-03:00");
    const period = resolveDefaultBillingPeriod(now, 15, 12);
    expect(period.issueDate).toBe("2026-08-12");
    expect(period.dueDate).toBe("2026-08-15");

    const payload = buildAsaasBoletoPaymentPayload({
      customerId: "cus_mock",
      value: 200,
      dueDate: period.dueDate,
      description: "mock",
      externalReference: "student-mock:2026-08-01",
    });
    expect(payload.billingType).toBe("BOLETO");
    expect(payload.fine.value).toBe(2);
    expect(payload.interest.value).toBe(1);

    const created = {
      id: "pay_mock",
      bankSlipUrl: "https://www.asaas.com/b/pdf/mock",
      invoiceUrl: "https://www.asaas.com/i/mock",
    };
    expect(preferBankSlipUrl(created)).toBe("https://www.asaas.com/b/pdf/mock");
    expect(shouldDispatchBillingWhatsApp({ sendWhatsApp: true, asaasPaymentId: created.id })).toBe(true);
    expect(shouldDispatchBillingWhatsApp({ sendWhatsApp: true, asaasPaymentId: null })).toBe(false);

    const familyRecipient = resolveMonthlyBillingWhatsAppRecipient({
      studentId: "child",
      studentWhatsapp: "5531999000001",
      responsiblePhone: "5531981044156",
    });
    expect(familyRecipient.recipient).toBe("5531981044156");

    expect(
      decideBillingGenerationAction(
        { id: "b-paid", status: "pago", asaas_payment_id: "pay_paid", updated_at: now.toISOString() },
        now,
      ).action,
    ).toBe("already_exists");
    expect(shouldCreateAsaasPayment(pickExistingAsaasPayment({ data: [created] }))).toBe(false);

    const afterWhatsAppFail = summarizeBillingProcessed([
      { studentId: "1", status: "generated" },
      { studentId: "1", status: "whatsapp_failed" },
    ]);
    expect(afterWhatsAppFail.created).toBe(1);
    expect(afterWhatsAppFail.errors).toBe(0);

    const afterAsaasFail = summarizeBillingProcessed([
      { studentId: "2", status: "failed", stage: "create_asaas_payment" },
    ]);
    expect(afterAsaasFail.created).toBe(0);
    expect(shouldDispatchBillingWhatsApp({ sendWhatsApp: true, asaasPaymentId: null })).toBe(false);

    expect(isWeekendIsoDate("2026-08-15")).toBe(true);
    expect(payload.dueDate).toBe("2026-08-15");

    const late = calculateBoletoLateCharges({
      principal: 200,
      dueDate: "2026-08-15",
      asOfDate: "2026-08-16",
    });
    expect(late.fine).toBe(4);
    expect(buildBillingUpdates("PAYMENT_RECEIVED", "2026-08-16T12:00:00.000Z")).not.toHaveProperty("amount");
    expect(assertSendableBoletoUrl("https://sandbox.asaas.com/b/pdf/x").ok).toBe(false);
  });
});

