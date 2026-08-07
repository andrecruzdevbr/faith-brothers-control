import { describe, expect, it } from "vitest";
import {
  buildCoverageMonths,
  buildFamilyApprovalSnapshot,
  isMachineBillingMode,
  maskTaxId,
  needsPaymentReview,
  planDisplayTotal,
  resolveInstallments,
  shouldSkipAsaasForPrepaidMonth,
  validateContractParty,
} from "@/lib/prepaid-contracts";

describe("cadastro individual prepaid", () => {
  it("marks machine plans for payment review and installment metadata", () => {
    expect(isMachineBillingMode("machine_prepaid")).toBe(true);
    expect(isMachineBillingMode("asaas_monthly")).toBe(false);
    expect(needsPaymentReview("aguardando_conferencia")).toBe(true);
    expect(needsPaymentReview("nao_aplicavel")).toBe(false);

    const total = planDisplayTotal({
      billing_mode: "machine_prepaid",
      package_total_amount: 900,
      monthly_price: 150,
    });
    expect(total).toBe(900);

    expect(
      resolveInstallments({
        paymentMethod: "cartao_credito",
        requestedInstallments: 6,
        allowsInstallments: true,
        maxInstallments: 6,
      }).installments,
    ).toBe(6);

    expect(
      resolveInstallments({
        paymentMethod: "pix",
        requestedInstallments: 6,
        allowsInstallments: true,
        maxInstallments: 6,
      }).installments,
    ).toBe(1);
  });

  it("creates six coverage months for individual package", () => {
    const months = buildCoverageMonths("2026-08-15", 6);
    expect(months).toHaveLength(6);
    expect(months[0]).toBe("2026-08-01");
    expect(months[5]).toBe("2027-01-01");
  });
});

describe("cadastro familiar pai + 2 filhos", () => {
  it("keeps three separate student ids under one family contract and one payment", () => {
    const father = "stu-pai";
    const child1 = "stu-filho-1";
    const child2 = "stu-filho-2";
    const familyGroupId = "fam-1";

    expect(validateContractParty({ familyGroupId }).ok).toBe(true);
    expect(validateContractParty({ studentId: father, familyGroupId }).ok).toBe(false);

    const snapshot = buildFamilyApprovalSnapshot({
      familyGroupId,
      memberStudentIds: [father, child1, child2],
      startsOn: "2026-08-15",
      durationMonths: 6,
      paymentMethod: "cartao_credito",
      installments: 6,
      totalAmount: 2700,
    });

    expect(snapshot.ok).toBe(true);
    expect(snapshot.studentCount).toBe(3);
    expect(snapshot.contractCount).toBe(1);
    expect(snapshot.paymentCount).toBe(1);
    expect(snapshot.monthsPerStudent).toHaveLength(6);
    expect(snapshot.totalMonthRows).toBe(18);
  });

  it("deduplicates member ids (no duplicate coverage rows)", () => {
    const snapshot = buildFamilyApprovalSnapshot({
      familyGroupId: "fam-1",
      memberStudentIds: ["a", "a", "b", "c"],
      startsOn: "2026-08-01",
      durationMonths: 6,
      paymentMethod: "dinheiro",
      installments: 3,
      totalAmount: 1000,
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.studentCount).toBe(3);
    expect(snapshot.totalMonthRows).toBe(18);
  });

  it("skips individual Asaas charges for every covered family member month", () => {
    for (const _student of ["pai", "filho1", "filho2"]) {
      expect(
        shouldSkipAsaasForPrepaidMonth({
          billingMode: "asaas_monthly",
          hasPaidCoverageForMonth: true,
          coverageSource: "family",
        }),
      ).toEqual({ skip: true, reason: "skipped_family_contract_covered" });
    }
  });

  it("masks financial responsible tax id for dependent profiles", () => {
    expect(maskTaxId("52998224725")).toMatch(/\*\*\*/);
    expect(maskTaxId("52998224725").endsWith("25")).toBe(true);
  });
});
