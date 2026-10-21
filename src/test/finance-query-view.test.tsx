import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryLoadError } from "@/components/QueryLoadError";
import { resolveQuerySectionView } from "@/lib/dashboard-view";
import { formatFinanceAxisTick, readFinanceExtras, sumReceivableAmounts } from "@/lib/finance-indicators";

describe("finance extras query", () => {
  it("throws instead of returning R$ 0 when A Receber fails", () => {
    expect(() =>
      readFinanceExtras({
        receivable: { data: [], error: { message: "permission denied for table billings" } },
        paid: { count: 0, error: null },
      }),
    ).toThrow(/permission denied/i);
  });

  it("throws instead of returning 0 paid when Pagos no Mês fails", () => {
    expect(() =>
      readFinanceExtras({
        receivable: { data: [{ amount: 180 }], error: null },
        paid: { count: 0, error: { message: "Failed to fetch" } },
      }),
    ).toThrow(/Failed to fetch/);
  });

  it("returns real zeros only when both queries succeed empty", () => {
    expect(
      readFinanceExtras({
        receivable: { data: [], error: null },
        paid: { count: 0, error: null },
      }),
    ).toEqual({ aReceber: 0, asaasPaidCount: 0 });
  });

  it("sums open billings when the query succeeds", () => {
    expect(
      readFinanceExtras({
        receivable: { data: [{ amount: 180 }, { amount: 230 }], error: null },
        paid: { count: 2, error: null },
      }),
    ).toEqual({ aReceber: 410, asaasPaidCount: 2 });
  });

  it.each([
    ["pendente", 180],
    ["gerado", 190],
    ["enviado_whatsapp", 200],
    ["vencido", 230],
  ] as const)("includes %s in A Receber", (status, amount) => {
    expect(sumReceivableAmounts([{ amount, status }])).toBe(amount);
  });

  it.each(["pago", "cancelado", "falhou"] as const)("excludes %s from A Receber", (status) => {
    expect(sumReceivableAmounts([{ amount: 999, status }])).toBe(0);
  });

  it("includes vencido with other open statuses and never double-counts a row", () => {
    const rows = [
      { amount: 180, status: "pendente" },
      { amount: 190, status: "gerado" },
      { amount: 200, status: "enviado_whatsapp" },
      { amount: 230, status: "vencido" },
      { amount: 999, status: "pago" },
      { amount: 888, status: "cancelado" },
    ];
    expect(sumReceivableAmounts(rows)).toBe(800);
    expect(sumReceivableAmounts(rows)).toBe(sumReceivableAmounts(rows));
  });
});

describe("finance section view", () => {
  it("does not treat a failed query as an empty list", () => {
    expect(
      resolveQuerySectionView({
        isLoading: false,
        isError: true,
        error: new Error("infinite recursion"),
        empty: true,
      }),
    ).toEqual({ status: "error", message: "infinite recursion" });
  });

  it("keeps an empty success distinct from an error", () => {
    expect(
      resolveQuerySectionView({
        isLoading: false,
        isError: false,
        error: null,
        empty: true,
      }),
    ).toEqual({ status: "empty" });
  });
});

describe("finance error recovery UI", () => {
  it("shows Tentar novamente without fake R$ 0", () => {
    const onRetry = vi.fn();
    render(
      <QueryLoadError
        compact
        title="Indicadores"
        message="permission denied for table billings"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
    expect(screen.queryByText("R$ 0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("finance axis ticks", () => {
  it("shows R$ 0 and hides invented ticks when every value is zero", () => {
    expect(formatFinanceAxisTick(0, [0, 0, 0])).toBe("R$ 0");
    expect(formatFinanceAxisTick(1, [0, 0, 0])).toBe("");
  });

  it("keeps thousand shorthand for larger series", () => {
    expect(formatFinanceAxisTick(2000, [0, 2000, 1500])).toBe("R$2k");
  });
});
