import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NewStudentPlanAccordion } from "@/components/NewStudentPlanAccordion";
import type { PlanOption } from "@/lib/plans";
import {
  buildSelectedPlanSummary,
  filterPlansForRegistrationAudience,
  groupNewStudentPlans,
  listOpenablePlanPeriods,
} from "@/lib/registration-flows";
import { useState } from "react";

function catalogPlan(
  partial: Partial<PlanOption> &
    Pick<PlanOption, "id" | "plan_kind" | "training_days_per_week" | "monthly_price">,
): PlanOption {
  return {
    name: partial.name ?? partial.id,
    audience: "new_student",
    billing_mode: partial.plan_kind === "mensal" ? "asaas_monthly" : "machine_prepaid",
    duration_months:
      partial.duration_months ??
      (partial.plan_kind === "mensal"
        ? 1
        : partial.plan_kind === "trimestral"
          ? 3
          : partial.plan_kind === "semestral"
            ? 6
            : 12),
    package_total_amount: partial.package_total_amount ?? partial.monthly_price,
    ...partial,
  };
}

const DAYS = [1, 2, 3, 5] as const;
const catalog: PlanOption[] = [
  ...DAYS.map((d, i) =>
    catalogPlan({
      id: `m${d}`,
      plan_kind: "mensal",
      training_days_per_week: d,
      monthly_price: [180, 210, 230, 250][i],
    }),
  ),
  ...DAYS.map((d, i) =>
    catalogPlan({
      id: `t${d}`,
      plan_kind: "trimestral",
      training_days_per_week: d,
      monthly_price: 100,
      package_total_amount: [480, 540, 630, 690][i],
    }),
  ),
  ...DAYS.map((d, i) =>
    catalogPlan({
      id: `s${d}`,
      plan_kind: "semestral",
      training_days_per_week: d,
      monthly_price: 100,
      package_total_amount: [990, 1155, 1260, 1350][i],
    }),
  ),
  ...DAYS.map((d, i) =>
    catalogPlan({
      id: `a${d}`,
      plan_kind: "anual",
      training_days_per_week: d,
      monthly_price: 100,
      package_total_amount: [1980, 2310, 2500, 2750][i],
    }),
  ),
];

function Harness() {
  const [planId, setPlanId] = useState("");
  return (
    <div>
      <NewStudentPlanAccordion plans={catalog} value={planId} onChange={setPlanId} />
      <div data-testid="selected-id">{planId || "none"}</div>
      {planId ? <div data-testid="payment-step">Forma de pagamento</div> : null}
    </div>
  );
}

describe("new student plan accordion UX", () => {
  it("shows 4 modalities closed initially", () => {
    render(<NewStudentPlanAccordion plans={catalog} value="" onChange={() => undefined} />);
    expect(screen.getByText("Mensal")).toBeTruthy();
    expect(screen.getByText("Trimestral")).toBeTruthy();
    expect(screen.getByText("Semestral")).toBeTruthy();
    expect(screen.getByText("Anual")).toBeTruthy();
    expect(screen.queryByText("1 dia por semana")).toBeNull();
    expect(listOpenablePlanPeriods(groupNewStudentPlans(catalog))).toEqual([
      "mensal",
      "trimestral",
      "semestral",
      "anual",
    ]);
  });

  it("opens Mensal then switching to Trimestral closes Mensal", () => {
    render(<NewStudentPlanAccordion plans={catalog} value="" onChange={() => undefined} />);
    fireEvent.click(screen.getByText("Mensal"));
    expect(screen.getAllByText(/dias? por semana/).length).toBe(4);
    fireEvent.click(screen.getByText("Trimestral"));
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.getByText("R$ 480,00")).toBeTruthy();
    expect(screen.queryByText("R$ 180,00")).toBeNull();
  });

  it("each modality lists 1/2/3/5 from catalog prices", () => {
    render(<NewStudentPlanAccordion plans={catalog} value="" onChange={() => undefined} />);
    for (const period of ["Mensal", "Trimestral", "Semestral", "Anual"] as const) {
      fireEvent.click(screen.getByText(period));
      const labels = screen.getAllByText(/dias? por semana/).map((n) => n.textContent);
      expect(labels).toEqual([
        "1 dia por semana",
        "2 dias por semana",
        "3 dias por semana",
        "5 dias por semana",
      ]);
    }
  });

  it("allows only one plan_id and replaces selection", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Semestral"));
    fireEvent.click(screen.getByText("3 dias por semana"));
    expect(screen.getByTestId("selected-id").textContent).toBe("s3");
    expect(screen.getByTestId("selected-plan-summary")).toBeTruthy();
    expect(within(screen.getByTestId("selected-plan-summary")).getByText("Semestral")).toBeTruthy();
    expect(within(screen.getByTestId("selected-plan-summary")).getByText("R$ 1.260,00")).toBeTruthy();
    expect(screen.getByTestId("payment-step")).toBeTruthy();

    fireEvent.click(screen.getByText("Mensal"));
    fireEvent.click(screen.getByText("2 dias por semana"));
    expect(screen.getByTestId("selected-id").textContent).toBe("m2");
    expect(within(screen.getByTestId("selected-plan-summary")).getByText("Mensal")).toBeTruthy();
  });

  it("summary uses catalog amounts (not hardcoded React constants for display)", () => {
    const plan = catalog.find((p) => p.id === "a5")!;
    const summary = buildSelectedPlanSummary(plan);
    expect(summary?.amount).toBe(2750);
    expect(summary?.durationLabel).toBe("12 meses");
    expect(summary?.planId).toBe("a5");
  });

  it("veteran filter keeps commercial catalog empty", () => {
    expect(filterPlansForRegistrationAudience(catalog, "veterano")).toEqual([]);
  });

  it("mobile-friendly headers remain full-width buttons", () => {
    render(<NewStudentPlanAccordion plans={catalog} value="" onChange={() => undefined} />);
    const mensal = screen.getByText("Mensal").closest("button");
    expect(mensal?.className).toMatch(/flex-1|w-full|flex/);
    expect(mensal?.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(mensal!);
    expect(mensal?.getAttribute("aria-expanded")).toBe("true");
    expect(mensal?.getAttribute("aria-controls")).toBeTruthy();
  });
});
