import { describe, it, expect, vi } from "vitest";
import {
  handleAsaasWebhookRequest,
  processAsaasWebhook,
  validateAsaasWebhookToken,
} from "../../supabase/functions/_shared/asaas-webhook.ts";

const WEBHOOK_TOKEN = "test-webhook-token";
const PAYMENT_ID = "pay_asaas_123";

const sampleBilling = {
  id: "billing-1",
  amount: 150,
  academy_id: "academy-1",
  student_id: "student-1",
  students: { full_name: "João Silva", whatsapp: "5511999999999" },
  plans: { name: "Mensalidade" },
};

type MockOptions = {
  updateData?: unknown;
  updateError?: { message: string } | null;
  lookupData?: { id: string; status: string } | null;
  lookupError?: { message: string } | null;
  familyData?: {
    family_groups: {
      financial_responsible_phone: string | null;
      financial_responsible_student_id: string | null;
    } | null;
  } | null;
};

function createSupabaseMock(options: MockOptions = {}) {
  const select = vi.fn(() => ({
    maybeSingle: vi.fn(async () => ({
      data: options.updateData ?? null,
      error: options.updateError ?? null,
    })),
  }));
  const filterChain = {
    neq: vi.fn(() => filterChain),
    eq: vi.fn(() => filterChain),
    select,
  };
  const eqAfterUpdate = vi.fn(() => filterChain);

  const update = vi.fn(() => ({
    eq: eqAfterUpdate,
  }));

  const lookupMaybeSingle = vi.fn(async () => ({
    data: options.lookupData ?? null,
    error: options.lookupError ?? null,
  }));

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "billings") {
        return {
          update,
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: lookupMaybeSingle,
            })),
          })),
        };
      }

      if (table === "whatsapp_messages") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }

      if (table === "family_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: options.familyData ?? null,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    _mocks: { neq: filterChain.neq, eq: filterChain.eq, update, lookupMaybeSingle },
  };

  return supabase;
}

describe("asaas-webhook idempotency", () => {
  it("first PAYMENT_CONFIRMED marks billing as paid and queues confirmation", async () => {
    const supabase = createSupabaseMock({ updateData: sampleBilling });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    const result = await processAsaasWebhook({
      payload: { event: "PAYMENT_CONFIRMED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
      now: () => new Date("2026-06-27T12:00:00.000Z"),
    });

    expect(result).toEqual({ ok: true });
    expect(supabase._mocks.neq).toHaveBeenCalledWith("status", "pago");
    expect(queueWhatsAppFn).toHaveBeenCalledTimes(1);
    expect(queueWhatsAppFn.mock.calls[0][0].messageType).toBe("payment_confirmation");
    expect(queueWhatsAppFn.mock.calls[0][0].recipient).toBe("5511999999999");
  });

  it("sends payment confirmation to the family financial responsible", async () => {
    const supabase = createSupabaseMock({
      updateData: sampleBilling,
      familyData: {
        family_groups: {
          financial_responsible_phone: "5531981044156",
          financial_responsible_student_id: "resp-1",
        },
      },
    });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient: string }) => ({
      messageId: "msg-1",
      sent: true,
    }));

    await processAsaasWebhook({
      payload: { event: "PAYMENT_CONFIRMED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    expect(queueWhatsAppFn).toHaveBeenCalledTimes(1);
    expect(queueWhatsAppFn.mock.calls[0][0].recipient).toBe("5531981044156");
    expect(queueWhatsAppFn.mock.calls[0][0].recipient).not.toBe(sampleBilling.students.whatsapp);
  });

  it("duplicate PAYMENT_CONFIRMED does not update again or queue another message", async () => {
    const supabase = createSupabaseMock({
      updateData: null,
      lookupData: { id: "billing-1", status: "pago" },
    });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    const result = await processAsaasWebhook({
      payload: { event: "PAYMENT_CONFIRMED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    expect(result).toEqual({ ok: true, duplicate: true });
    expect(supabase._mocks.neq).toHaveBeenCalledWith("status", "pago");
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
  });

  it("missing billing returns ok without failing", async () => {
    const supabase = createSupabaseMock({
      updateData: null,
      lookupData: null,
    });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    const result = await processAsaasWebhook({
      payload: { event: "PAYMENT_CONFIRMED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    expect(result).toEqual({ ok: true });
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
  });

  it("invalid token returns 401", async () => {
    const supabase = createSupabaseMock();
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    const result = await handleAsaasWebhookRequest({
      accessToken: "wrong-token",
      webhookToken: WEBHOOK_TOKEN,
      payload: { event: "PAYMENT_CONFIRMED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Invalid webhook token" });
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
  });
});

describe("validateAsaasWebhookToken", () => {
  it("accepts matching token only", () => {
    expect(validateAsaasWebhookToken(WEBHOOK_TOKEN, WEBHOOK_TOKEN)).toBe(true);
    expect(validateAsaasWebhookToken(null, WEBHOOK_TOKEN)).toBe(false);
    expect(validateAsaasWebhookToken("other", WEBHOOK_TOKEN)).toBe(false);
  });
});

describe("asaas homologation — late / refund / chargeback", () => {
  it("PAYMENT_OVERDUE on paid billing does not update (neq pago)", async () => {
    const supabase = createSupabaseMock({ updateData: null, lookupData: { id: "billing-1", status: "pago" } });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    const result = await processAsaasWebhook({
      payload: { event: "PAYMENT_OVERDUE", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    // Update matches zero rows because of .neq("status","pago"); no duplicate flag on overdue path.
    expect(result).toEqual({ ok: true });
    expect(supabase._mocks.neq).toHaveBeenCalledWith("status", "pago");
    expect(supabase._mocks.update).toHaveBeenCalledWith({ status: "vencido" });
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
  });

  it("PAYMENT_DELETED on paid billing does not cancel", async () => {
    const supabase = createSupabaseMock({ updateData: null, lookupData: { id: "billing-1", status: "pago" } });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    const result = await processAsaasWebhook({
      payload: { event: "PAYMENT_DELETED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    expect(result).toEqual({ ok: true });
    expect(supabase._mocks.neq).toHaveBeenCalledWith("status", "pago");
    expect(supabase._mocks.update).toHaveBeenCalledWith({ status: "cancelado" });
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
  });

  it("PAYMENT_REFUNDED only matches pago via eq filter", async () => {
    const supabase = createSupabaseMock({
      updateData: { ...sampleBilling, status: "cancelado" },
    });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    const result = await processAsaasWebhook({
      payload: { event: "PAYMENT_REFUNDED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    expect(result).toEqual({ ok: true });
    expect(supabase._mocks.update).toHaveBeenCalledWith({ status: "cancelado" });
    expect(supabase._mocks.eq).toHaveBeenCalledWith("status", "pago");
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
  });

  it("PAYMENT_CHARGEBACK_REQUESTED cancels only when update hits a paid row", async () => {
    const supabase = createSupabaseMock({
      updateData: { ...sampleBilling, status: "cancelado" },
    });
    const queueWhatsAppFn = vi.fn(async (_params: { messageType: string; recipient?: string }) => ({ messageId: "msg-1", sent: true }));

    await processAsaasWebhook({
      payload: { event: "PAYMENT_CHARGEBACK_REQUESTED", payment: { id: PAYMENT_ID } },
      supabase: supabase as never,
      queueWhatsAppFn,
    });

    expect(supabase._mocks.update).toHaveBeenCalledWith({ status: "cancelado" });
    expect(queueWhatsAppFn).not.toHaveBeenCalled();
  });
});
