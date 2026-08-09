import { describe, expect, it } from "vitest";
import {
  buildRegistrationApprovedIdempotencyKey,
  buildRegistrationApprovedMessage,
  buildRegistrationReceivedIdempotencyKey,
  buildVeteranPeriodRequestIdempotencyKey,
  buildVeteranPeriodRequestMessage,
} from "../../supabase/functions/_shared/whatsapp-messages.ts";

describe("registration WhatsApp templates", () => {
  it("builds approval message without incorrect financial claims", () => {
    const body = buildRegistrationApprovedMessage("Laura");
    expect(body).toContain("Laura");
    expect(body).toContain("aprovado");
    expect(body.toLowerCase()).not.toContain("boleto");
    expect(body.toLowerCase()).not.toContain("r$");
  });

  it("builds veteran commercial follow-up with desired frequency", () => {
    const body = buildVeteranPeriodRequestMessage("Hugão", 3);
    expect(body).toContain("aprovado");
    expect(body).toContain("3 dias por semana");
    expect(body).toContain("plano e a forma de pagamento");
  });

  it("accepts 1-day frequency in veteran follow-up", () => {
    expect(buildVeteranPeriodRequestMessage("Laura", 1)).toContain("1 dia por semana");
  });

  it("uses distinct idempotency keys per event", () => {
    const id = "stu-1";
    const keys = [
      buildRegistrationReceivedIdempotencyKey(id),
      buildRegistrationApprovedIdempotencyKey(id),
      buildVeteranPeriodRequestIdempotencyKey(id),
    ];
    expect(new Set(keys).size).toBe(3);
  });
});
