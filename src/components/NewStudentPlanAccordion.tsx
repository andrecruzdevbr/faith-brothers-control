import { useId, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/api";
import type { PlanOption } from "@/lib/plans";
import { planDisplayTotal } from "@/lib/prepaid-contracts";
import {
  billingPeriodTitle,
  buildSelectedPlanSummary,
  formatTrainingDaysLabel,
  groupNewStudentPlans,
  listOpenablePlanPeriods,
  type BillingPeriodChoice,
} from "@/lib/registration-flows";

type Props = {
  plans: PlanOption[];
  value?: string;
  onChange: (planId: string) => void;
  disabled?: boolean;
};

export function NewStudentPlanAccordion({ plans, value, onChange, disabled }: Props) {
  const baseId = useId();
  const accordionRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupNewStudentPlans(plans), [plans]);
  const periods = useMemo(() => listOpenablePlanPeriods(groups), [groups]);
  const [openPeriod, setOpenPeriod] = useState<string>("");

  const selected = useMemo(
    () => plans.find((p) => p.id === value) ?? null,
    [plans, value],
  );
  const summary = useMemo(() => buildSelectedPlanSummary(selected), [selected]);

  const handleSelect = (planId: string) => {
    onChange(planId);
  };

  const handleAlterarPlano = () => {
    const period =
      summary?.period && summary.period !== "outro" ? summary.period : periods[0];
    if (period) setOpenPeriod(period);
    accordionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    window.requestAnimationFrame(() => {
      const trigger = accordionRef.current?.querySelector<HTMLElement>(
        period ? `#${CSS.escape(`${baseId}-${period}-trigger`)}` : "button",
      );
      trigger?.focus();
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold tracking-wide">ESCOLHA SEU PLANO</p>

      <div ref={accordionRef}>
        <Accordion
          type="single"
          collapsible
          value={openPeriod}
          onValueChange={(next) => setOpenPeriod(next ?? "")}
          className="w-full rounded-xl border border-border bg-card"
        >
          {periods.map((period) => {
            const list = groups[period];
            const contentId = `${baseId}-${period}-content`;
            const triggerId = `${baseId}-${period}-trigger`;
            return (
              <AccordionItem key={period} value={period} className="border-border px-1">
                <AccordionTrigger
                  id={triggerId}
                  aria-controls={contentId}
                  disabled={disabled}
                  className="min-h-12 px-3 text-left text-base hover:no-underline sm:text-sm"
                >
                  {billingPeriodTitle(period)}
                </AccordionTrigger>
                <AccordionContent id={contentId} className="px-3">
                  <div
                    className="space-y-2 pb-1"
                    role="radiogroup"
                    aria-label={billingPeriodTitle(period)}
                  >
                    {list.map((plan) => {
                      const selectedPlan = value === plan.id;
                      const amount = planDisplayTotal({
                        billing_mode: plan.billing_mode,
                        package_total_amount: plan.package_total_amount,
                        monthly_price: plan.monthly_price,
                      });
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          role="radio"
                          aria-checked={selectedPlan}
                          disabled={disabled}
                          onClick={() => handleSelect(plan.id)}
                          className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition ${
                            selectedPlan
                              ? "border-primary bg-primary/10"
                              : "border-border bg-background hover:border-primary/40"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              selectedPlan ? "border-primary" : "border-muted-foreground/50"
                            }`}
                            aria-hidden
                          >
                            {selectedPlan ? (
                              <span className="h-2 w-2 rounded-full bg-primary" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">
                              {formatTrainingDaysLabel(plan.training_days_per_week)}
                            </span>
                            <span className="block text-sm font-semibold text-primary">
                              {formatCurrency(amount)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      {summary ? (
        <div
          className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1"
          data-testid="selected-plan-summary"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plano selecionado
          </p>
          <p className="text-base font-semibold text-foreground">{summary.periodTitle}</p>
          <p className="text-sm text-foreground">{summary.daysLabel}</p>
          <p className="text-base font-semibold text-primary">{formatCurrency(summary.amount)}</p>
          {summary.durationLabel ? (
            <p className="text-xs text-muted-foreground">{summary.durationLabel}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={handleAlterarPlano}
          >
            Alterar plano
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function openPeriodsForTest(plans: PlanOption[]): BillingPeriodChoice[] {
  return listOpenablePlanPeriods(groupNewStudentPlans(plans));
}
