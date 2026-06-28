import { describe, it, expect } from "vitest";
import {
  buildAsaasPaymentsLookupPath,
  buildExternalReference,
  buildFailedProcessedEntry,
  pickExistingAsaasPayment,
  shouldCreateAsaasPayment,
  shouldUpdateAsaasCustomer,
} from "../../supabase/functions/_shared/asaas-billing.ts";

describe("asaas-billing idempotency", () => {
  it("builds stable externalReference", () => {
    expect(buildExternalReference("ced46b69-4293-48dd-b04f-300bb835150f", "2026-06-01")).toBe(
      "ced46b69-4293-48dd-b04f-300bb835150f:2026-06-01",
    );
  });

  it("builds encoded lookup path for externalReference", () => {
    const ref = buildExternalReference("student-id", "2026-06-01");
    expect(buildAsaasPaymentsLookupPath(ref)).toBe(
      `/payments?externalReference=${encodeURIComponent(ref)}&limit=1`,
    );
  });

  it("reuses existing Asaas payment when list returns data", () => {
    const existing = { id: "pay_existing", externalReference: "student:2026-06-01" };
    expect(pickExistingAsaasPayment({ data: [existing] })).toEqual(existing);
    expect(shouldCreateAsaasPayment(pickExistingAsaasPayment({ data: [existing] }))).toBe(false);
  });

  it("requires POST when no Asaas payment exists", () => {
    expect(pickExistingAsaasPayment({ data: [] })).toBeNull();
    expect(pickExistingAsaasPayment({})).toBeNull();
    expect(shouldCreateAsaasPayment(null)).toBe(true);
  });

  it("updates Asaas customer when cpfCnpj is missing or changed", () => {
    expect(shouldUpdateAsaasCustomer("", "52998224725")).toBe(true);
    expect(shouldUpdateAsaasCustomer("52998224725", "52998224725")).toBe(false);
    expect(shouldUpdateAsaasCustomer("52998224725", "11222333000181")).toBe(true);
  });
});

describe("buildFailedProcessedEntry", () => {
  it("returns failed status with stage and sanitized error message", () => {
    expect(
      buildFailedProcessedEntry({
        studentId: "ced46b69-4293-48dd-b04f-300bb835150f",
        stage: "create_asaas_payment",
        error: new Error("Asaas [400]: CPF 52998224725 inválido"),
      }),
    ).toEqual({
      studentId: "ced46b69-4293-48dd-b04f-300bb835150f",
      status: "failed",
      stage: "create_asaas_payment",
      error: "Asaas [400]: CPF [documento] inválido",
    });
  });

  it("includes billingId when local insert succeeded before failure", () => {
    const result = buildFailedProcessedEntry({
      studentId: "student-1",
      stage: "queue_whatsapp",
      error: "WhatsApp queue failed",
      billingId: "billing-uuid",
    });
    expect(result.billingId).toBe("billing-uuid");
    expect(result.stage).toBe("queue_whatsapp");
  });
});
