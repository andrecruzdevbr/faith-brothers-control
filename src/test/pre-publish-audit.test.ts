import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STUDENT_STATUS_LABELS } from "@/lib/constants";
import { buildStudentStatusChart, throwIfQueryFailed } from "@/lib/dashboard-view";
import {
  OPEN_BILLING_STATUSES,
  RECEIVABLE_BILLING_STATUSES,
  formatFinanceAxisTick,
  readFinanceExtras,
  reconcileMonthRevenue,
  sumReceivableAmounts,
  sumReceipts,
} from "@/lib/finance-indicators";
import { billingDefaults, buildCatalogPlanWrite } from "@/lib/plan-catalog-editor";

describe("audit — student status chart vs real statuses", () => {
  it("knows four persisted student statuses", () => {
    expect(Object.keys(STUDENT_STATUS_LABELS).sort()).toEqual(
      ["ativo", "inativo", "pendente_aprovacao", "rejeitado"].sort(),
    );
  });

  it("separates pending from rejected instead of leftover arithmetic", () => {
    const chart = buildStudentStatusChart({
      active: 2,
      inactive: 1,
      pending: 1,
      rejected: 1,
    });
    expect(chart.slices.find((s) => s.name === "Pendentes")?.value).toBe(1);
    expect(chart.slices.find((s) => s.name === "Rejeitados")?.value).toBe(1);
  });
});

describe("audit — finance extras vs dashboard receipts", () => {
  it("A Receber includes vencido and keeps due-soon statuses separate", () => {
    expect([...OPEN_BILLING_STATUSES]).toEqual(["pendente", "gerado", "enviado_whatsapp"]);
    expect([...RECEIVABLE_BILLING_STATUSES]).toEqual([
      "pendente",
      "gerado",
      "enviado_whatsapp",
      "vencido",
    ]);
    expect(
      sumReceivableAmounts([
        { amount: 180, status: "pendente" },
        { amount: 230, status: "vencido" },
        { amount: 50, status: "pago" },
      ]),
    ).toBe(410);
  });

  it("keeps Asaas paid count distinct from consolidated month revenue", () => {
    const extras = readFinanceExtras({
      receivable: { data: [], error: null },
      paid: { count: 3, error: null },
    });
    const revenue = sumReceipts({
      billings: [
        { studentId: "a", referenceMonth: "2026-10-01", amount: 180 },
        { studentId: "b", referenceMonth: "2026-10-01", amount: 230 },
      ],
      coveredMonths: [],
      contractPayments: [{ amount: 760 }],
    });
    expect(extras.asaasPaidCount).toBe(3);
    expect(revenue).toBe(1170);
    expect(extras.asaasPaidCount).not.toBe(revenue);
  });

  it("reconciles Dashboard and Relatórios month revenue from the same sumReceipts rule", () => {
    const receipts = {
      billings: [{ studentId: "a", referenceMonth: "2026-10-01", amount: 180 }],
      coveredMonths: [],
      contractPayments: [{ amount: 760 }],
    };
    const dashboardRevenue = sumReceipts(receipts);
    const reportSeriesValue = sumReceipts(receipts);
    expect(reconcileMonthRevenue({ dashboardRevenue, reportSeriesValue })).toEqual({
      ok: true,
      dashboardRevenue: 940,
      reportSeriesValue: 940,
    });
  });

  it("does not double-count a prepaid month already covered by the contract", () => {
    expect(
      sumReceipts({
        billings: [{ studentId: "child", referenceMonth: "2026-10-01", amount: 760 }],
        coveredMonths: [{ studentId: "child", referenceMonth: "2026-10-01" }],
        contractPayments: [{ amount: 760 }],
      }),
    ).toBe(760);
  });
});

describe("audit — prepaid rounding and catalog writes", () => {
  it("splits an indivisible package with cent rounding", () => {
    const write = buildCatalogPlanWrite({
      mode: "update",
      academyId: "academy",
      draft: {
        name: "Veterano trimestral",
        audience: "veterano",
        plan_kind: "mensal",
        training_days_per_week: "3",
        price: "1000",
        active: "true",
      },
      original: {
        id: "vet",
        name: "Veterano trimestral",
        audience: "veterano",
        plan_kind: "trimestral",
        training_days_per_week: 3,
        monthly_price: 333.33,
        package_total_amount: 1000,
        duration_months: 3,
        billing_mode: "machine_prepaid",
        allows_installments: true,
        max_installments: 12,
        active: true,
      },
    });
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    expect(write.payload.package_total_amount).toBe(1000);
    expect(write.payload.monthly_price).toBe(333.33);
    expect(write.payload.monthly_price * 3).toBeCloseTo(999.99, 2);
  });

  it("create of mensal still uses Asaas monthly billing_mode", () => {
    expect(billingDefaults("mensal").billing_mode).toBe("asaas_monthly");
    const write = buildCatalogPlanWrite({
      mode: "create",
      academyId: "academy",
      draft: {
        name: "Novo mensal",
        audience: "new_student",
        plan_kind: "mensal",
        training_days_per_week: "3",
        price: "230",
        active: "true",
      },
    });
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    expect(write.payload.audience).toBe("new_student");
    expect(write.payload.billing_mode).toBe("asaas_monthly");
    expect(write.payload.package_total_amount).toBeNull();
  });

  it("update of official new_student still allows a price change pending commercial lock", () => {
    const write = buildCatalogPlanWrite({
      mode: "update",
      academyId: "academy",
      draft: {
        name: "Plano 3 dias por semana",
        audience: "veterano",
        plan_kind: "anual",
        training_days_per_week: "5",
        price: "999",
        active: "false",
      },
      original: {
        id: "ns",
        name: "Plano 3 dias por semana",
        audience: "new_student",
        plan_kind: "mensal",
        training_days_per_week: 3,
        monthly_price: 230,
        package_total_amount: null,
        duration_months: 1,
        billing_mode: "asaas_monthly",
        active: true,
      },
    });
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    expect(write.payload.audience).toBe("new_student");
    expect(write.payload.monthly_price).toBe(999);
    expect(write.payload.active).toBe(false);
  });
});

describe("audit — query failure must not become empty success", () => {
  it("throwIfQueryFailed still catches satellite dashboard queries", () => {
    expect(() =>
      throwIfQueryFailed([
        { error: null },
        { error: { message: "permission denied for table attendances" } },
      ]),
    ).toThrow(/attendances/);
  });

  it("axis formatter does not invent thousands when the series is zero", () => {
    expect(formatFinanceAxisTick(0, [0, 0, 0, 0, 0, 0])).toBe("R$ 0");
    expect(formatFinanceAxisTick(0.25, [0, 0, 0, 0, 0, 0])).toBe("");
  });
});

describe("audit — Relatórios belt chart and recent billings window", () => {
  it("builds faixa distribution from useBeltDistribution, not from ranking", () => {
    const relatorios = readFileSync(resolve(process.cwd(), "src/pages/Relatorios.tsx"), "utf8");
    expect(relatorios).toContain("useBeltDistribution");
    expect(relatorios).toContain("buildBeltDistribution(beltStudents");
    expect(relatorios).not.toMatch(/for \(const s of ranking/);
  });

  it("filters report billings by the same recent window used in the chart title", () => {
    const relatorios = readFileSync(resolve(process.cwd(), "src/pages/Relatorios.tsx"), "utf8");
    const reportHook = readFileSync(resolve(process.cwd(), "src/hooks/useQueries.ts"), "utf8");
    expect(relatorios).toContain("COBRANÇAS DOS ÚLTIMOS 6 MESES POR STATUS");
    const reportFn = reportHook.slice(reportHook.indexOf("export function useReportBillings"));
    const billingsQuery = reportFn.slice(
      reportFn.indexOf('.from("billings")'),
      reportFn.indexOf("student_contract_months"),
    );
    expect(billingsQuery).toContain(".gte(\"reference_month\", sinceIso)");
  });
});

describe("audit — seed-admin remains gated in code", () => {
  it("refuses to seed unless ALLOW_DEV_SEED is explicitly true", () => {
    const source = readFileSync(
      resolve(process.cwd(), "supabase/functions/seed-admin-users/index.ts"),
      "utf8",
    );
    expect(source).toContain('getEnvOptional("ALLOW_DEV_SEED") === "true"');
    expect(source).toContain("Seed desabilitado em produção");
    expect(source).toContain("incomingSecret !== seedSecret");
  });
});
