import { describe, expect, it } from "vitest";
import {
  buildRegistrationApprovedIdempotencyKey,
  buildRegistrationApprovedMessage,
  buildRegistrationReceivedIdempotencyKey,
  buildVeteranPeriodRequestIdempotencyKey,
  buildVeteranPeriodRequestMessage,
} from "../../supabase/functions/_shared/whatsapp-messages.ts";

describe("registration WhatsApp templates", () => {
  it("builds approval message without claiming access already released", () => {
    const body = buildRegistrationApprovedMessage("Gabriel", "card");
    expect(body).toContain("Gabriel");
    expect(body).toContain("aprovado");
    expect(body).toContain("etapa financeira");
    expect(body.toLowerCase()).not.toContain("acesso já foi liberado");
    expect(body.toLowerCase()).not.toContain("boleto");
    expect(body.toLowerCase()).not.toContain("r$");
  });

  it("adapts closing by flow variant", () => {
    expect(buildRegistrationApprovedMessage("A", "boleto")).toContain("fluxo de cobrança");
    expect(buildRegistrationApprovedMessage("A", "veteran")).toContain("plano e a forma de pagamento");
    expect(buildRegistrationApprovedMessage("A", "family")).toContain("família");
  });

  it("uses stable registration_approved idempotency key once", () => {
    const id = "96bd42eb-ab0c-4f4b-9c43-1ce9734718be";
    expect(buildRegistrationApprovedIdempotencyKey(id)).toBe(`registration:${id}:approved`);
    expect(buildRegistrationApprovedIdempotencyKey(id)).toBe(buildRegistrationApprovedIdempotencyKey(id));
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
