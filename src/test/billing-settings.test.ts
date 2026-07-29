import { describe, it, expect } from "vitest";
import {
  formatBillingSettingsLabel,
  getBillingSettings,
  getMissingBillingSkipStatus,
  hasValidStudentWhatsapp,
  resolveSendWhatsApp,
  shouldSkipBeforeIssueDay,
  summarizeBillingProcessed,
} from "../../supabase/functions/_shared/billing-settings.ts";
import { summarizeBillingRunText, formatBillingErrorDetail, collectBillingErrors } from "@/lib/billing";

const sampleSettings = {
  boleto_issue_day: 1,
  boleto_due_day: 15,
  send_whatsapp_automatically: true,
};

describe("getBillingSettings", () => {
  it("returns object when relation is a single embed", () => {
    expect(getBillingSettings(sampleSettings)).toEqual(sampleSettings);
  });

  it("returns first item when relation is an array", () => {
    expect(getBillingSettings([sampleSettings])).toEqual(sampleSettings);
  });

  it("returns null for null, undefined, or empty array", () => {
    expect(getBillingSettings(null)).toBeNull();
    expect(getBillingSettings(undefined)).toBeNull();
    expect(getBillingSettings([])).toBeNull();
  });
});

describe("getMissingBillingSkipStatus", () => {
  it("returns null when plan and settings exist", () => {
    expect(getMissingBillingSkipStatus(true, true)).toBeNull();
  });

  it("returns specific skip codes", () => {
    expect(getMissingBillingSkipStatus(false, true)).toBe("skipped_missing_plan");
    expect(getMissingBillingSkipStatus(true, false)).toBe("skipped_missing_billing_settings");
    expect(getMissingBillingSkipStatus(false, false)).toBe("skipped_missing_plan_and_settings");
  });
});

describe("billing due day 15 and manual force", () => {
  it("formats settings label with due day 15 and auto send", () => {
    expect(formatBillingSettingsLabel(sampleSettings)).toContain("Vencimento dia 15");
    expect(formatBillingSettingsLabel(sampleSettings)).toContain("Envio automático ativo");
  });

  it("skips before issue day unless force=true", () => {
    expect(shouldSkipBeforeIssueDay(5, 12, false)).toBe(true);
    expect(shouldSkipBeforeIssueDay(5, 12, true)).toBe(false);
    expect(shouldSkipBeforeIssueDay(15, 1, false)).toBe(false);
  });

  it("resolves sendWhatsApp override for admin buttons", () => {
    expect(resolveSendWhatsApp(true, false)).toBe(false);
    expect(resolveSendWhatsApp(false, true)).toBe(true);
    expect(resolveSendWhatsApp(true, undefined)).toBe(true);
  });

  it("validates student WhatsApp for billing send", () => {
    expect(hasValidStudentWhatsapp("31999999999")).toBe(true);
    expect(hasValidStudentWhatsapp("5531999999999")).toBe(true);
    expect(hasValidStudentWhatsapp("")).toBe(false);
    expect(hasValidStudentWhatsapp("123")).toBe(false);
  });
});

describe("summarizeBillingProcessed", () => {
  it("aggregates generate and whatsapp outcomes", () => {
    const summary = summarizeBillingProcessed([
      { studentId: "1", status: "generated" },
      { studentId: "2", status: "already_exists" },
      { studentId: "3", status: "skipped_missing_plan" },
      { studentId: "4", status: "skipped_missing_tax_id" },
      { studentId: "5", status: "skipped_missing_whatsapp" },
      { studentId: "6", status: "sent_whatsapp" },
      { studentId: "7", status: "queued_whatsapp_send_disabled" },
      { studentId: "8", status: "failed" },
      { studentId: "9", status: "whatsapp_sent" },
    ]);

    expect(summary.created).toBe(3);
    expect(summary.alreadyExists).toBe(1);
    expect(summary.skippedMissingPlan).toBe(1);
    expect(summary.skippedMissingTaxId).toBe(1);
    expect(summary.skippedMissingWhatsApp).toBe(1);
    expect(summary.whatsappSent).toBe(2);
    expect(summary.whatsappSkipped).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("builds UI summary lines", () => {
    const lines = summarizeBillingRunText({
      created: 1,
      alreadyExists: 2,
      skippedMissingPlan: 0,
      skippedMissingTaxId: 1,
      skippedMissingWhatsApp: 0,
      whatsappSent: 1,
      whatsappSkipped: 0,
      errors: 0,
    });
    expect(lines[0]).toContain("criadas: 1");
    expect(lines.some((l) => l.includes("CPF/CNPJ"))).toBe(true);
  });

  it("formats safe error details for the modal", () => {
    const line = formatBillingErrorDetail({
      studentId: "ced46b69-4293-48dd-b04f-300bb835150f",
      studentName: "Maria",
      status: "failed",
      stage: "create_asaas_payment",
      error: "Asaas [400]: CPF [documento] inválido",
      asaasHttpStatus: 400,
      asaasDescription: "CPF [documento] inválido",
    });
    expect(line).toContain("Maria");
    expect(line).toContain("create_asaas_payment");
    expect(line).toContain("400");
    expect(line).not.toContain("52998224725");
  });

  it("collects failed rows from processed payload", () => {
    const errors = collectBillingErrors([
      { studentId: "1", status: "generated" },
      { studentId: "2", status: "failed", stage: "ensure_customer", error: "falhou" },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].studentId).toBe("2");
  });
});
