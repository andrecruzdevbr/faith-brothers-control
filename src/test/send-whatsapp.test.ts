import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_WHATSAPP_FIELDS_REQUIRED,
  ADMIN_WHATSAPP_NUMBER_INVALID,
  isValidWhatsAppNumber,
  parseAdminWhatsAppSendRequest,
  toEvolutionNumber,
} from "../../supabase/functions/_shared/phone.ts";
import { hasValidStudentWhatsapp } from "../../supabase/functions/_shared/billing-settings.ts";

describe("isValidWhatsAppNumber", () => {
  it("accepts national and E.164 Brazil mobiles", () => {
    expect(isValidWhatsAppNumber("31999999999")).toBe(true);
    expect(isValidWhatsAppNumber("55 31 99999-9999")).toBe(true);
    expect(isValidWhatsAppNumber("5531999999999")).toBe(true);
  });

  it("rejects junk that Evolution would prefix with 55", () => {
    expect(isValidWhatsAppNumber("")).toBe(false);
    expect(isValidWhatsAppNumber("1")).toBe(false);
    expect(toEvolutionNumber("1")).toBe("551");
    expect(isValidWhatsAppNumber("123")).toBe(false);
    expect(isValidWhatsAppNumber("55")).toBe(false);
  });

  it("stays aligned with billing recipient validation", () => {
    expect(hasValidStudentWhatsapp("31999999999")).toBe(isValidWhatsAppNumber("31999999999"));
    expect(hasValidStudentWhatsapp("123")).toBe(isValidWhatsAppNumber("123"));
  });
});

describe("parseAdminWhatsAppSendRequest", () => {
  it("requires number and message", () => {
    expect(parseAdminWhatsAppSendRequest({})).toEqual({
      ok: false,
      error: ADMIN_WHATSAPP_FIELDS_REQUIRED,
    });
    expect(parseAdminWhatsAppSendRequest({ numero: "31999999999", mensagem: "   " })).toEqual({
      ok: false,
      error: ADMIN_WHATSAPP_FIELDS_REQUIRED,
    });
  });

  it("rejects invalid numbers before queueing", () => {
    expect(parseAdminWhatsAppSendRequest({ numero: "1", mensagem: "teste" })).toEqual({
      ok: false,
      error: ADMIN_WHATSAPP_NUMBER_INVALID,
    });
  });

  it("accepts a homolog-style number", () => {
    expect(parseAdminWhatsAppSendRequest({ numero: "5531981044156", mensagem: "canario" })).toEqual({
      ok: true,
      recipient: "5531981044156",
      body: "canario",
    });
  });
});

describe("send-whatsapp wiring", () => {
  it("validates input through parseAdminWhatsAppSendRequest", () => {
    const src = readFileSync(
      resolve(process.cwd(), "supabase/functions/send-whatsapp/index.ts"),
      "utf8",
    );
    expect(src).toContain("parseAdminWhatsAppSendRequest");
    expect(src).toContain("status: 400");
    expect(src).not.toContain("recipient: String(numero)");
  });
});
