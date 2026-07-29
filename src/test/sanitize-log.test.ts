import { describe, it, expect } from "vitest";
import { sanitizeLogError } from "../../supabase/functions/_shared/sanitize-log.ts";

describe("sanitizeLogError", () => {
  it("redacts apikey assignments", () => {
    const out = sanitizeLogError(new Error("apikey=secret-should-not-leak Evolution failed"));
    expect(out).not.toContain("secret-should-not-leak");
    expect(out).toContain("[REDACTED]");
    expect(out.toLowerCase()).not.toContain("apikey=secret");
  });

  it("redacts bearer and authorization headers", () => {
    const out = sanitizeLogError("Authorization: Bearer abcdef.token.value");
    expect(out).not.toContain("abcdef.token.value");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts known env key names", () => {
    const out = sanitizeLogError("WHATSAPP_EVOLUTION_API_KEY=super-secret AUTHENTICATION_API_KEY=also-secret");
    expect(out).not.toContain("super-secret");
    expect(out).not.toContain("also-secret");
    expect(out).toContain("[REDACTED]");
  });
});
