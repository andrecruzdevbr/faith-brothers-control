import { describe, expect, it } from "vitest";
import {
  buildContractEndsOn,
  buildCoverageMonths,
  estimatedInstallmentAmount,
  familyCronSkipReason,
  resolveInstallments,
  shouldSkipAsaasForPrepaidMonth,
  toMonthStart,
  validateContractParty,
} from "@/lib/prepaid-contracts";

describe("prepaid coverage months (V1 mid-month rule)", () => {
  it("starts coverage on the civil month of starts_on", () => {
    expect(toMonthStart("2026-08-15")).toBe("2026-08-01");
    expect(buildCoverageMonths("2026-08-15", 6)).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  it("computes ends_on as last day of final covered month", () => {
    expect(buildContractEndsOn("2026-08-15", 6)).toBe("2027-01-31");
  });

  it("avulso creates no future months", () => {
    expect(buildCoverageMonths("2026-08-15", 0)).toEqual([]);
    expect(buildCoverageMonths("2026-08-15", -1)).toEqual([]);
  });
});

describe("installments metadata", () => {
  it("forces 1 installment for debit/pix/cash", () => {
    for (const method of ["cartao_debito", "pix", "dinheiro"] as const) {
      expect(
        resolveInstallments({
          paymentMethod: method,
          requestedInstallments: 6,
          allowsInstallments: true,
          maxInstallments: 6,
        }).installments,
      ).toBe(1);
    }
  });

  it("allows credit installments within max", () => {
    expect(
      resolveInstallments({
        paymentMethod: "cartao_credito",
        requestedInstallments: 6,
        allowsInstallments: true,
        maxInstallments: 6,
      }),
    ).toEqual({ installments: 6 });
  });

  it("rejects credit installments above max", () => {
    const result = resolveInstallments({
      paymentMethod: "cartao_credito",
      requestedInstallments: 12,
      allowsInstallments: true,
      maxInstallments: 6,
    });
    expect(result.error).toBeTruthy();
  });

  it("estimates installment amount", () => {
    expect(estimatedInstallmentAmount(900, 6)).toBe(150);
  });
});

describe("Asaas skip rules", () => {
  it("skips when prepaid month is covered", () => {
    expect(
      shouldSkipAsaasForPrepaidMonth({
        billingMode: "asaas_monthly",
        hasPaidCoverageForMonth: true,
        coverageSource: "individual",
      }),
    ).toEqual({ skip: true, reason: "skipped_prepaid_month_covered" });
  });

  it("skips with family reason when source is family", () => {
    expect(
      shouldSkipAsaasForPrepaidMonth({
        billingMode: "asaas_monthly",
        hasPaidCoverageForMonth: true,
        coverageSource: "family",
      }),
    ).toEqual({ skip: true, reason: "skipped_family_contract_covered" });
  });

  it("skips non-asaas plan even without coverage row", () => {
    expect(
      shouldSkipAsaasForPrepaidMonth({
        billingMode: "machine_prepaid",
        hasPaidCoverageForMonth: false,
      }),
    ).toEqual({ skip: true, reason: "skipped_non_asaas_plan" });
  });

  it("does not skip normal monthly without coverage", () => {
    expect(
      shouldSkipAsaasForPrepaidMonth({
        billingMode: "asaas_monthly",
        hasPaidCoverageForMonth: false,
      }),
    ).toEqual({ skip: false });
  });

  it("family coverage reason", () => {
    expect(familyCronSkipReason(true)).toBe("skipped_family_contract_covered");
    expect(familyCronSkipReason(false)).toBeNull();
  });
});

describe("contract party XOR", () => {
  it("rejects both or neither", () => {
    expect(validateContractParty({ studentId: "a", familyGroupId: "b" }).ok).toBe(false);
    expect(validateContractParty({}).ok).toBe(false);
  });

  it("accepts exclusive parties", () => {
    expect(validateContractParty({ studentId: "a" }).ok).toBe(true);
    expect(validateContractParty({ familyGroupId: "b" }).ok).toBe(true);
  });
});
