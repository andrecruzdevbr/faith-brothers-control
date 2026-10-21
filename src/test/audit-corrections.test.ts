import { describe, expect, it } from "vitest";
import { billingStatusTransition } from "../../supabase/functions/_shared/asaas-webhook.ts";
import { selectCurrentContract } from "@/lib/contracts";
import {
  buildMonthlyReceiptSeries,
  countDelinquentStudents,
  deriveOverallStatus,
  isBillingUniqueViolation,
  isDueSoon,
  sumReceipts,
} from "@/lib/finance-indicators";
import { resolveFriendlyPlanSituationStatus } from "@/lib/student-plan-situation";

describe("audit regression — financial status", () => {
  it("does not show Em Dia when an older billing is overdue", () => {
    const status = deriveOverallStatus(
      [
        { status: "pago", due_date: "2026-10-10" },
        { status: "vencido", due_date: "2026-08-10" },
      ],
      "2026-10-19",
    );
    expect(status).toBe("atrasado");
  });

  it("counts one delinquent student even with two open debts", () => {
    expect(
      countDelinquentStudents(
        [
          { studentId: "a", status: "pendente", dueDate: "2026-10-01" },
          { studentId: "a", status: "vencido", dueDate: "2026-09-01" },
          { studentId: "b", status: "pago", dueDate: "2026-09-01" },
        ],
        "2026-10-19",
      ),
    ).toBe(1);
  });

  it("treats upcoming open charges as due soon, not overdue", () => {
    expect(
      isDueSoon({ studentId: "a", status: "pendente", dueDate: "2026-10-22" }, "2026-10-19"),
    ).toBe(true);
    expect(
      isDueSoon({ studentId: "a", status: "pendente", dueDate: "2026-10-01" }, "2026-10-19"),
    ).toBe(false);
  });
});

describe("audit regression — asaas and receipts", () => {
  it("does not let a late overdue event revert a paid billing", () => {
    expect(billingStatusTransition("pago", "PAYMENT_OVERDUE")).toBeNull();
    expect(billingStatusTransition("pago", "PAYMENT_DELETED")).toBeNull();
    expect(billingStatusTransition("pendente", "PAYMENT_OVERDUE")).toBe("vencido");
  });

  it("records refunds only from a settled payment", () => {
    expect(billingStatusTransition("pago", "PAYMENT_REFUNDED")).toBe("cancelado");
    expect(billingStatusTransition("pendente", "PAYMENT_REFUNDED")).toBeNull();
    expect(billingStatusTransition("pago", "PAYMENT_CHARGEBACK_REQUESTED")).toBe("cancelado");
  });

  it("adds contract receipts once and skips billings already covered by the package", () => {
    const total = sumReceipts({
      billings: [
        { studentId: "child", referenceMonth: "2026-10-01", amount: 760 },
        { studentId: "other", referenceMonth: "2026-10-01", amount: 180 },
      ],
      coveredMonths: [{ studentId: "child", referenceMonth: "2026-10-01" }],
      contractPayments: [{ amount: 760 }],
    });
    expect(total).toBe(940);
    expect(total).not.toBe(760 * 3);
  });

  it("adds a family contract receipt once in the monthly series", () => {
    const series = buildMonthlyReceiptSeries({
      asOf: new Date("2026-10-19T12:00:00"),
      billings: [
        { studentId: "a", referenceMonth: "2026-10-01", amount: 180, status: "pago" },
        { studentId: "b", referenceMonth: "2026-10-01", amount: 180, status: "pago" },
      ],
      coveredMonths: [{ studentId: "a", referenceMonth: "2026-10-01" }],
      contractPayments: [{ amount: 760, confirmedAt: "2026-10-02T15:00:00" }],
    });
    const october = series.find((row) => row.key === "2026-10");
    expect(october?.valor).toBe(940);
    expect(series).toHaveLength(6);
  });

  it("recognizes a unique billing insert conflict", () => {
    expect(isBillingUniqueViolation({ code: "23505", message: "duplicate key" })).toBe(true);
    expect(isBillingUniqueViolation({ message: "insert failed" })).toBe(false);
  });
});

describe("audit regression — contracts", () => {
  it("selects the contract whose window contains today", () => {
    const current = selectCurrentContract(
      [
        { id: "old", starts_on: "2025-01-01", ends_on: "2025-12-31", contract_status: "ativo" },
        { id: "now", starts_on: "2026-08-01", ends_on: "2026-12-31", contract_status: "ativo" },
        { id: "future", starts_on: "2027-01-01", ends_on: "2027-06-30", contract_status: "ativo" },
      ],
      "2026-10-19",
    );
    expect(current?.id).toBe("now");
  });

  it("marks a paid contract past its end date as expired when asOf is provided", () => {
    expect(
      resolveFriendlyPlanSituationStatus({
        status: "ativo",
        approved_at: "2026-01-01",
        payment_review_status: "confirmado",
        contract: {
          ends_on: "2026-08-31",
          payment_status: "pago",
          contract_status: "ativo",
        },
        coverageMonths: [{ reference_month: "2026-08-01", status: "pago" }],
        asOf: "2026-10-19",
      }),
    ).toBe("Contrato expirado");
  });
});
