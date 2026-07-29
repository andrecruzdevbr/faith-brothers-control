import { describe, it, expect } from "vitest";
import {
  createEmptyVerifyFields,
  digitsOnly,
} from "../pages/RecuperarSenha";

describe("RecuperarSenha field isolation", () => {
  it("starts verify fields with empty code", () => {
    const fields = createEmptyVerifyFields();
    expect(fields.code).toBe("");
    expect(fields.newPassword).toBe("");
    expect(fields.confirmPassword).toBe("");
  });

  it("accepts digit typing into code up to 6 chars", () => {
    expect(digitsOnly("1", 6)).toBe("1");
    expect(digitsOnly("12a3", 6)).toBe("123");
    expect(digitsOnly("654321", 6)).toBe("654321");
    expect(digitsOnly("65432199", 6)).toBe("654321");
  });

  it("does not keep full WhatsApp value inside code field", () => {
    const whatsapp = "31985010010";
    const codeFromWhatsappPaste = digitsOnly(whatsapp, 6);
    expect(codeFromWhatsappPaste).not.toBe(whatsapp);
    expect(codeFromWhatsappPaste.length).toBe(6);
    expect(createEmptyVerifyFields().code).not.toBe(whatsapp);
  });

  it("changing WhatsApp digits never equals a forced code seed", () => {
    const whatsapp = digitsOnly("31 98501-0010", 13);
    const code = createEmptyVerifyFields().code;
    expect(whatsapp).toBe("31985010010");
    expect(code).toBe("");
    expect(code).not.toBe(whatsapp);
  });
});
