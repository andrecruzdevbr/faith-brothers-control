import { describe, expect, it } from "vitest";
import {
  isWhatsAppRecipientAllowed,
  parseWhatsAppAllowedRecipients,
  WHATSAPP_RECIPIENT_NOT_ALLOWED,
} from "../../supabase/functions/_shared/whatsapp-allowlist.ts";

const AUTHORIZED = "5531981044156";

describe("parseWhatsAppAllowedRecipients", () => {
  it("leaves Production unrestricted when the env is unset", () => {
    expect(parseWhatsAppAllowedRecipients(undefined)).toBeNull();
    expect(parseWhatsAppAllowedRecipients(null)).toBeNull();
  });

  it("blocks every recipient when the env is present but empty", () => {
    expect(parseWhatsAppAllowedRecipients("")).toEqual([]);
    expect(parseWhatsAppAllowedRecipients("   ")).toEqual([]);
  });

  it("normalizes the authorized homolog number", () => {
    expect(parseWhatsAppAllowedRecipients("5531981044156")).toEqual([AUTHORIZED]);
    expect(parseWhatsAppAllowedRecipients("31981044156")).toEqual([AUTHORIZED]);
    expect(parseWhatsAppAllowedRecipients("55 31 98104-4156")).toEqual([AUTHORIZED]);
  });
});

describe("isWhatsAppRecipientAllowed", () => {
  const allowlist = parseWhatsAppAllowedRecipients(AUTHORIZED);

  it("allows the authorized number and equivalent national formats", () => {
    expect(isWhatsAppRecipientAllowed(AUTHORIZED, allowlist)).toBe(true);
    expect(isWhatsAppRecipientAllowed("31981044156", allowlist)).toBe(true);
  });

  it("blocks any other recipient before Evolution", () => {
    expect(isWhatsAppRecipientAllowed("11900000001", allowlist)).toBe(false);
    expect(isWhatsAppRecipientAllowed("5531985010010", allowlist)).toBe(false);
    expect(isWhatsAppRecipientAllowed("31981044156", [])).toBe(false);
  });

  it("does not restrict when the allowlist env is unset", () => {
    expect(isWhatsAppRecipientAllowed("11900000001", null)).toBe(true);
  });
});

describe("allowlist reason", () => {
  it("uses a stable block reason", () => {
    expect(WHATSAPP_RECIPIENT_NOT_ALLOWED).toBe("recipient_not_allowed");
  });
});
