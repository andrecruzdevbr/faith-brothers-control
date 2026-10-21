import { describe, expect, it } from "vitest";
import {
  BILLING_GENERATION_CLAIM_MARKER,
  BILLING_GENERATION_STALE_MS,
  buildExternalReference,
  decideBillingGenerationAction,
  isBillingUniqueViolation,
  pickExistingAsaasPayment,
  shouldCreateAsaasPayment,
} from "../../supabase/functions/_shared/asaas-billing.ts";

describe("billing generation concurrency", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");

  it("requires a local claim before Asaas create when no row exists", () => {
    expect(decideBillingGenerationAction(null, now)).toEqual({ action: "create_claim" });
  });

  it("skips paid and rows that already have an Asaas payment", () => {
    expect(
      decideBillingGenerationAction(
        { id: "b1", status: "pago", asaas_payment_id: "pay_1", updated_at: now.toISOString() },
        now,
      ),
    ).toEqual({ action: "already_exists", billingId: "b1" });

    expect(
      decideBillingGenerationAction(
        {
          id: "b2",
          status: "gerado",
          asaas_payment_id: "pay_2",
          updated_at: now.toISOString(),
        },
        now,
      ),
    ).toEqual({ action: "already_exists", billingId: "b2" });
  });

  it("treats a fresh claim without payment as in-progress (blocks second Asaas create)", () => {
    expect(
      decideBillingGenerationAction(
        {
          id: "b3",
          status: "pendente",
          asaas_payment_id: null,
          last_error: BILLING_GENERATION_CLAIM_MARKER,
          updated_at: now.toISOString(),
        },
        now,
      ),
    ).toEqual({ action: "in_progress", billingId: "b3" });
  });

  it("allows completing a stale orphan claim after timeout", () => {
    const staleAt = new Date(now.getTime() - BILLING_GENERATION_STALE_MS - 1_000).toISOString();
    expect(
      decideBillingGenerationAction(
        {
          id: "b4",
          status: "pendente",
          asaas_payment_id: null,
          last_error: BILLING_GENERATION_CLAIM_MARKER,
          updated_at: staleAt,
        },
        now,
      ),
    ).toEqual({ action: "complete_claimed", billingId: "b4" });
  });

  it("reprocesses failed/cancelado without inventing a second claim row", () => {
    expect(
      decideBillingGenerationAction(
        { id: "b5", status: "falhou", asaas_payment_id: null, updated_at: now.toISOString() },
        now,
      ),
    ).toEqual({ action: "reprocess_failed", billingId: "b5" });
  });

  it("uses stable externalReference and prefers existing Asaas payment", () => {
    const ref = buildExternalReference("student-1", "2026-10-01");
    expect(ref).toBe("student-1:2026-10-01");
    const existing = pickExistingAsaasPayment({
      data: [{ id: "pay_existing", externalReference: ref }],
    });
    expect(shouldCreateAsaasPayment(existing)).toBe(false);
    expect(shouldCreateAsaasPayment(null)).toBe(true);
  });

  it("detects unique claim conflicts from Postgres", () => {
    expect(isBillingUniqueViolation({ code: "23505", message: "duplicate key" })).toBe(true);
    expect(isBillingUniqueViolation({ message: "timeout" })).toBe(false);
  });

  it("two concurrent workers: winner claims, loser sees in_progress", () => {
    const winner = decideBillingGenerationAction(null, now);
    expect(winner.action).toBe("create_claim");

    const afterWinnerClaim = decideBillingGenerationAction(
      {
        id: "claimed",
        status: "pendente",
        asaas_payment_id: null,
        last_error: BILLING_GENERATION_CLAIM_MARKER,
        updated_at: now.toISOString(),
      },
      now,
    );
    expect(afterWinnerClaim).toEqual({ action: "in_progress", billingId: "claimed" });
    // Loser must not call shouldCreateAsaasPayment(null) path for a fresh create.
    expect(afterWinnerClaim.action).not.toBe("create_claim");
  });
});
