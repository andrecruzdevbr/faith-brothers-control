import { describe, it, expect } from "vitest";
import { normalizeWhatsapp, whatsappToEmail, formatWhatsapp, getLoginCredentials, isValidBrazilianWhatsapp } from "@/lib/whatsapp-auth";

const ADMIN_WHATSAPPS = [
  "31987540515",
  "31998565661",
  "31997586456",
  "31981044156",
  "31987438874",
];

describe("whatsapp-auth", () => {
  it("normalizes digits and strips country code", () => {
    expect(normalizeWhatsapp("5531987540515")).toBe("31987540515");
    expect(normalizeWhatsapp("(31) 98754-0515")).toBe("31987540515");
  });

  it("builds synthetic email", () => {
    expect(whatsappToEmail("31987540515")).toBe("31987540515@wa.faithbrothers.app");
    expect(whatsappToEmail("31981044156")).toBe("31981044156@wa.faithbrothers.app");
  });

  it("builds login credentials for all staff whatsapp numbers", () => {
    for (const whatsapp of ADMIN_WHATSAPPS) {
      const { email, password } = getLoginCredentials(whatsapp, "faithbrothers2026");
      expect(email).toBe(`${whatsapp}@wa.faithbrothers.app`);
      expect(password).toBe("faithbrothers2026");
    }
  });

  it("strips +55 prefix before building email", () => {
    expect(getLoginCredentials("5531981044156", "x").email).toBe("31981044156@wa.faithbrothers.app");
  });

  it("validates brazilian whatsapp with 11 digits", () => {
    expect(isValidBrazilianWhatsapp("31988888888")).toBe(true);
    expect(isValidBrazilianWhatsapp("3198888888")).toBe(false);
    expect(isValidBrazilianWhatsapp("5531988888888")).toBe(true);
  });
});

describe("RBAC constants", () => {
  it("admin-only paths are defined", async () => {
    const { ADMIN_ONLY_PATHS, ACADEMY_LIMITED_PATHS } = await import("@/lib/constants");
    expect(ADMIN_ONLY_PATHS).toContain("/financeiro");
    expect(ADMIN_ONLY_PATHS).toContain("/configuracoes");
    expect(ACADEMY_LIMITED_PATHS).toContain("/turmas");
    expect(ACADEMY_LIMITED_PATHS).not.toContain("/financeiro");
  });
});
