import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WHATSAPP_TEST_ACCEPTED_TITLE,
  WHATSAPP_TEST_DISABLED_DETAILS,
  WHATSAPP_TEST_ERROR_TITLE,
  WHATSAPP_TEST_NO_DELIVERY_CONFIRMATION,
  WHATSAPP_TEST_NOT_SENT_DETAILS,
  WHATSAPP_TEST_SKIPPED_TITLE,
  interpretSendWhatsAppTestResponse,
} from "@/lib/whatsapp-test-send";

const NUMBER = "(11) 98888-7777";

describe("interpretSendWhatsAppTestResponse", () => {
  it("treats sent: true as accepted for send, not delivery confirmation", () => {
    const outcome = interpretSendWhatsAppTestResponse(
      { success: true, sent: true, skipped: false, number: "11988887777" },
      NUMBER,
    );
    expect(outcome.kind).toBe("sent");
    expect(outcome.title).toBe(WHATSAPP_TEST_ACCEPTED_TITLE);
    expect(outcome.details).toContain(NUMBER);
    expect(outcome.details).toContain(WHATSAPP_TEST_NO_DELIVERY_CONFIRMATION);
    expect(outcome.toastTitle).not.toBe("Mensagem enviada!");
  });

  it("never shows sent confirmation when sent is false", () => {
    const outcome = interpretSendWhatsAppTestResponse(
      { success: true, sent: false, skipped: false },
      NUMBER,
    );
    expect(outcome.kind).toBe("skipped");
    expect(outcome.title).toBe(WHATSAPP_TEST_SKIPPED_TITLE);
    expect(outcome.title).not.toContain("Mensagem enviada");
    expect(outcome.toastTitle).not.toContain("Mensagem enviada");
    expect(outcome.details).toContain(WHATSAPP_TEST_NOT_SENT_DETAILS);
  });

  it("shows a clear disabled message when skipped: true", () => {
    const outcome = interpretSendWhatsAppTestResponse(
      {
        success: true,
        sent: false,
        skipped: true,
        reason: "WHATSAPP_SEND_ENABLED=false",
      },
      NUMBER,
    );
    expect(outcome.kind).toBe("skipped");
    expect(outcome.title).toBe(WHATSAPP_TEST_SKIPPED_TITLE);
    expect(outcome.details).toBe(WHATSAPP_TEST_DISABLED_DETAILS);
    expect(outcome.toastTitle).toBe(WHATSAPP_TEST_SKIPPED_TITLE);
    expect(JSON.stringify(outcome)).not.toMatch(/Mensagem enviada/);
  });

  it("maps API errors to a send failure", () => {
    const outcome = interpretSendWhatsAppTestResponse(
      { success: false, sent: false, error: "Evolution API timeout after 15000ms" },
      NUMBER,
    );
    expect(outcome.kind).toBe("error");
    expect(outcome.title).toBe(WHATSAPP_TEST_ERROR_TITLE);
    expect(outcome.details).toContain("Evolution API timeout");
    expect(outcome.toastVariant).toBe("destructive");
    expect(outcome.title).not.toContain("Mensagem enviada");
  });
});

describe("Configuracoes Testar WhatsApp wiring", () => {
  it("interprets send-whatsapp by sent/skipped instead of success alone", () => {
    const src = readFileSync("src/pages/Configuracoes.tsx", "utf8");
    expect(src).toContain("interpretSendWhatsAppTestResponse");
    expect(src).not.toMatch(/if \(data\.success\)/);
    expect(src).not.toMatch(/toast\(\{\s*title:\s*"Mensagem enviada!"/);
  });
});
