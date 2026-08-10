import { describe, expect, it } from "vitest";
import {
  FAITH_BROTHERS_WHATSAPP_SIGNATURE,
  buildRegistrationApprovedIdempotencyKey,
  buildRegistrationApprovedMessage,
  buildRegistrationReceivedIdempotencyKey,
  buildVeteranPeriodRequestIdempotencyKey,
  buildVeteranPeriodRequestMessage,
} from "../../supabase/functions/_shared/whatsapp-messages.ts";

describe("registration WhatsApp templates", () => {
  it("builds approval message without claiming payment confirmed", () => {
    const body = buildRegistrationApprovedMessage("Gabriel", "card");
    expect(body).toContain("Gabriel");
    expect(body).toContain("aprovado");
    expect(body).toContain("aguardando a confirmação do pagamento");
    expect(body).toContain(FAITH_BROTHERS_WHATSAPP_SIGNATURE);
    expect(body.toLowerCase()).not.toContain("pagamento confirmado");
    expect(body.toLowerCase()).not.toContain("r$");
  });

  it("builds veteran approval with desired frequency", () => {
    const body = buildVeteranPeriodRequestMessage("Hugão", 3);
    expect(body).toContain("aprovado");
    expect(body).toContain("frequência de treino foi registrada");
    expect(body).toContain("plano e a forma de pagamento");
    expect(body).toContain(FAITH_BROTHERS_WHATSAPP_SIGNATURE);
  });

  it("accepts 1-day frequency in veteran follow-up", () => {
    expect(buildVeteranPeriodRequestMessage("Laura", 1)).toContain("frequência de treino foi registrada");
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
