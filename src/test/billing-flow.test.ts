import { describe, expect, it } from "vitest";
import { assertSendableBoletoUrl, isSandboxBoletoUrl } from "@/lib/billing";
import {
  buildOverdueReminderMessage,
  canReprocessFailedBilling,
  isAfterOverdueReminderDay,
} from "../../supabase/functions/_shared/billing-overdue.ts";
import { summarizeOverdueReminderText } from "@/lib/billing";
import { resolveDefaultBillingPeriod } from "@/lib/billing";

describe("sandbox boleto block", () => {
  it("detects Asaas sandbox URLs", () => {
    expect(isSandboxBoletoUrl("https://sandbox.asaas.com/i/abc")).toBe(true);
    expect(isSandboxBoletoUrl("https://www.asaas.com/i/abc")).toBe(false);
    expect(isSandboxBoletoUrl(null)).toBe(false);
  });

  it("blocks missing and sandbox boletos from send", () => {
    expect(assertSendableBoletoUrl(null)).toEqual({ ok: false, reason: "missing_boleto" });
    expect(assertSendableBoletoUrl("https://sandbox.asaas.com/i/x")).toEqual({
      ok: false,
      reason: "sandbox_boleto",
    });
    expect(assertSendableBoletoUrl("https://www.asaas.com/i/x")).toEqual({
      ok: true,
      url: "https://www.asaas.com/i/x",
    });
  });
});

describe("overdue reminder rules", () => {
  it("only allows reminders after day 18 of due month", () => {
    expect(
      isAfterOverdueReminderDay("2026-07-15", new Date("2026-07-18T12:00:00-03:00")),
    ).toBe(false);
    expect(
      isAfterOverdueReminderDay("2026-07-15", new Date("2026-07-19T12:00:00-03:00")),
    ).toBe(true);
  });

  it("builds a distinct overdue message with existing boleto link", () => {
    const msg = buildOverdueReminderMessage({
      academyName: "Faith Brothers",
      studentName: "Maria",
      referenceMonth: "2026-07-01",
      dueDate: "2026-07-15",
      boletoUrl: "https://www.asaas.com/i/abc",
      financeContact: "Ramon",
      financeWhatsapp: "31987540515",
    });
    expect(msg).toContain("ainda está em aberto");
    expect(msg).toContain("Julho/2026");
    expect(msg).toContain("15/07/2026");
    expect(msg).toContain("https://www.asaas.com/i/abc");
    expect(msg).not.toContain("Sua mensalidade foi gerada");
  });

  it("allows reprocess only for cancelado/falhou", () => {
    expect(canReprocessFailedBilling("cancelado")).toBe(true);
    expect(canReprocessFailedBilling("falhou")).toBe(true);
    expect(canReprocessFailedBilling("pago")).toBe(false);
    expect(canReprocessFailedBilling("gerado")).toBe(false);
  });

  it("summarizes overdue operation for UI", () => {
    const lines = summarizeOverdueReminderText({
      overdueFound: 3,
      summary: { whatsappSent: 2, whatsappSkipped: 1, errors: 0 },
    });
    expect(lines[0]).toContain("atrasadas encontradas: 3");
    expect(lines.some((l) => l.includes("enviadas: 2"))).toBe(true);
  });
});

describe("reference month drives button labels", () => {
  it("uses next month label after day 15 (no hardcoded Agosto)", () => {
    const period = resolveDefaultBillingPeriod(new Date("2026-07-29T12:00:00-03:00"), 15, 10);
    expect(period.labelPt).toBe("Agosto/2026");
    expect(`Gerar e enviar ${period.labelPt}`).toBe("Gerar e enviar Agosto/2026");
  });

  it("uses current month label between days 10 and 15", () => {
    const period = resolveDefaultBillingPeriod(new Date("2026-08-12T12:00:00-03:00"), 15, 10);
    expect(period.labelPt).toBe("Agosto/2026");
    expect(period.issueDateLabelPt).toBe("10/08/2026");
    expect(period.dueDateLabelPt).toBe("15/08/2026");
  });
});
