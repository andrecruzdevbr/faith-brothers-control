import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, formatDateBR } from "@/lib/api";
import { selectCurrentContract } from "@/lib/contracts";
import { buildStudentPlanSituationView } from "@/lib/student-plan-situation";
import { maskTaxId } from "@/lib/prepaid-contracts";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlanOption } from "@/lib/plans";

type Props = {
  studentId: string;
};

function formatAmountLabel(raw: string | null): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return formatCurrency(n);
}

function formatPeriodLabel(period: string | null): string | null {
  if (!period) return null;
  const [start, end] = period.split(" até ");
  if (!start || !end) return period;
  return `${formatDateBR(start)} até ${formatDateBR(end)}`;
}

export function StudentContractOverview({ studentId }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["student-plan-situation", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data: studentRow, error: studentError } = await supabase
        .from("students")
        .select(
          "id, full_name, birth_date, belt, degrees, status, approved_at, payment_review_status, registration_audience, requested_training_days, requested_payment_method, plan_id, plans(id, name, monthly_price, package_total_amount, duration_months, billing_mode, plan_kind, training_days_per_week, audience)",
        )
        .eq("id", studentId)
        .maybeSingle();
      if (studentError) throw studentError;

      const { data: months, error: monthsError } = await supabase
        .from("student_contract_months")
        .select("id, reference_month, status, source, contract_id, paid_at")
        .eq("student_id", studentId)
        .order("reference_month", { ascending: true });
      if (monthsError) throw monthsError;

      const monthRows = (months ?? []) as Array<{
        id: string;
        reference_month: string;
        status: string;
        source: string;
        contract_id: string;
        paid_at: string | null;
      }>;

      type ContractRow = {
        id: string;
        starts_on: string;
        ends_on: string;
        weekly_frequency: number | null;
        total_amount: number;
        payment_method: string;
        installments: number;
        contract_status: string;
        payment_status: string;
        duration_months: number | null;
        family_group_id: string | null;
        student_id: string | null;
        plans?: { name?: string | null; plan_kind?: string | null; training_days_per_week?: number | null } | null;
      };

      const monthContractIds = [...new Set(monthRows.map((m) => m.contract_id).filter(Boolean))];
      const { data: ownedContracts } = await supabase
        .from("student_contracts")
        .select(
          "id, starts_on, ends_on, weekly_frequency, total_amount, payment_method, installments, contract_status, payment_status, duration_months, family_group_id, student_id, plans(name, plan_kind, training_days_per_week)",
        )
        .eq("student_id", studentId);

      let linkedContracts: ContractRow[] = [];
      if (monthContractIds.length) {
        const { data: byMonth } = await supabase
          .from("student_contracts")
          .select(
            "id, starts_on, ends_on, weekly_frequency, total_amount, payment_method, installments, contract_status, payment_status, duration_months, family_group_id, student_id, plans(name, plan_kind, training_days_per_week)",
          )
          .in("id", monthContractIds);
        linkedContracts = (byMonth ?? []) as ContractRow[];
      }

      const byId = new Map<string, ContractRow>();
      for (const row of [...((ownedContracts ?? []) as ContractRow[]), ...linkedContracts]) {
        byId.set(row.id, row);
      }
      const contracts = Array.from(byId.values());
      const today = new Date().toISOString().slice(0, 10);
      const contract =
        selectCurrentContract(contracts, today) ??
        contracts.find((c) => c.id === monthRows.find((m) => m.status === "pago")?.contract_id) ??
        contracts[0] ??
        null;

      let family: {
        name: string;
        financial_responsible_name: string;
        financial_responsible_tax_id: string | null;
        financial_responsible_student_id: string | null;
      } | null = null;
      let memberFrequency: number | null = null;

      const { data: fm } = await supabase
        .from("family_members")
        .select(
          "relationship, status, requested_weekly_frequency, family_groups(name, financial_responsible_name, financial_responsible_tax_id, financial_responsible_student_id)",
        )
        .eq("student_id", studentId)
        .in("status", ["ativo", "pendente"])
        .limit(1)
        .maybeSingle();

      if (fm) {
        const row = fm as {
          requested_weekly_frequency?: number | null;
          family_groups:
            | {
                name: string;
                financial_responsible_name: string;
                financial_responsible_tax_id: string | null;
                financial_responsible_student_id: string | null;
              }
            | {
                name: string;
                financial_responsible_name: string;
                financial_responsible_tax_id: string | null;
                financial_responsible_student_id: string | null;
              }[]
            | null;
        };
        const g = Array.isArray(row.family_groups) ? row.family_groups[0] : row.family_groups;
        memberFrequency = row.requested_weekly_frequency ?? null;
        if (g) family = g;
      }

      const { data: latestBilling } = await supabase
        .from("billings")
        .select("status")
        .eq("student_id", studentId)
        .order("reference_month", { ascending: false })
        .limit(1)
        .maybeSingle();

      const planRaw = studentRow?.plans;
      const plan = (Array.isArray(planRaw) ? planRaw[0] : planRaw) as PlanOption | null;
      const isFamilyMember = Boolean(family);
      const isResponsible =
        family?.financial_responsible_student_id != null &&
        family.financial_responsible_student_id === studentId;
      const hideFinancialDetails = isFamilyMember && !isResponsible;

      const view = buildStudentPlanSituationView({
        status: studentRow?.status,
        approved_at: studentRow?.approved_at,
        payment_review_status: studentRow?.payment_review_status,
        registration_audience: studentRow?.registration_audience,
        requested_training_days: studentRow?.requested_training_days ?? memberFrequency,
        requested_payment_method: studentRow?.requested_payment_method,
        plan: plan
          ? {
              ...plan,
              training_days_per_week:
                plan.training_days_per_week ??
                (Array.isArray(contract?.plans)
                  ? contract?.plans[0]?.training_days_per_week
                  : contract?.plans?.training_days_per_week) ??
                null,
            }
          : null,
        contract: contract
          ? {
              starts_on: contract.starts_on,
              ends_on: contract.ends_on,
              weekly_frequency: contract.weekly_frequency ?? memberFrequency,
              total_amount: contract.total_amount,
              payment_method: contract.payment_method,
              payment_status: contract.payment_status,
              contract_status: contract.contract_status,
              duration_months: contract.duration_months,
            }
          : null,
        coverageMonths: monthRows.map((m) => ({
          reference_month: m.reference_month,
          status: m.status,
        })),
        latestBillingStatus: latestBilling?.status ?? null,
        asOf: new Date().toISOString().slice(0, 10),
        isFamilyMember,
        hideFinancialDetails,
      });

      return { view, family, studentRow, hideFinancialDetails, isFamilyMember };
    },
  });

  if (isLoading) {
    return <Skeleton className="h-40 rounded-xl" />;
  }

  if (isError) {
    return <p className="text-sm text-destructive">Não foi possível carregar o contrato vigente.</p>;
  }

  if (!data?.view) return null;

  const { view, family, studentRow, hideFinancialDetails } = data;
  const amount = formatAmountLabel(view.amountLabel);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-bold tracking-wide">{view.title}</h2>
      </div>

      <div className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Cadastro:</span>{" "}
            <span className="font-medium uppercase tracking-wide">{view.registrationLabel}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Status:</span>{" "}
            <span className="font-medium">{view.statusLabel}</span>
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Plano</p>
          <p className="text-base font-semibold text-foreground">{view.planLabel}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">{view.frequencyCaption}:</span>{" "}
            <span className="font-medium">{view.frequencyLabel}</span>
          </p>
          {view.financialLabel ? (
            <p>
              <span className="text-muted-foreground">
                {view.isVeteranAwaitingPlan ? "Pagamento" : "Financeiro"}:
              </span>{" "}
              <span className="font-medium">{view.financialLabel}</span>
            </p>
          ) : view.paymentLabel ? (
            <p>
              <span className="text-muted-foreground">Pagamento:</span>{" "}
              <span className="font-medium">{view.paymentLabel}</span>
            </p>
          ) : null}
          {view.paymentMethodLabel && !view.isVeteranAwaitingPlan ? (
            <p>
              <span className="text-muted-foreground">Forma de pagamento:</span>{" "}
              <span className="font-medium">{view.paymentMethodLabel}</span>
            </p>
          ) : null}
          {amount && !hideFinancialDetails && !view.isAwaitingPaymentConfirm ? (
            <p>
              <span className="text-muted-foreground">Valor:</span>{" "}
              <span className="font-medium">
                {amount}
                {view.amountSuffix ?? ""}
              </span>
            </p>
          ) : null}
          {view.totalAmountLabel && !hideFinancialDetails && !view.isAwaitingPaymentConfirm ? (
            <p>
              <span className="text-muted-foreground">Total contratado:</span>{" "}
              <span className="font-medium">{formatAmountLabel(view.totalAmountLabel)}</span>
            </p>
          ) : null}
          {view.periodLabel ? (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Período:</span>{" "}
              <span className="font-medium">{formatPeriodLabel(view.periodLabel)}</span>
            </p>
          ) : null}
          {view.coverageCountLabel ? (
            <p>
              <span className="text-muted-foreground">Cobertura:</span>{" "}
              <span className="font-medium">{view.coverageCountLabel}</span>
            </p>
          ) : null}
        </div>

        {view.statusMessage ? (
          <p className="rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
            {view.statusMessage}
          </p>
        ) : null}

        {family ? (
          <div className="rounded-lg border border-border/60 p-3 space-y-1">
            <p className="font-medium">Plano familiar</p>
            {studentRow ? (
              <p>
                <span className="text-muted-foreground">Aluno:</span> {studentRow.full_name}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Grupo:</span> {family.name}
            </p>
            <p>
              <span className="text-muted-foreground">Responsável financeiro:</span>{" "}
              {family.financial_responsible_name}
            </p>
            {!hideFinancialDetails ? (
              <p>
                <span className="text-muted-foreground">CPF/CNPJ cobrança:</span>{" "}
                {maskTaxId(family.financial_responsible_tax_id)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Detalhes financeiros ficam com o responsável / administração.
              </p>
            )}
          </div>
        ) : null}

        {view.showCoverageAsPaid && view.coverage.length > 0 ? (
          <div>
            <p className="text-sm font-medium mb-2">Meses liberados</p>
            <ul className="grid gap-1 sm:grid-cols-2 text-sm">
              {view.coverage.map((m) => (
                <li key={m.referenceMonth} className="rounded-md bg-success/10 text-success px-2 py-1">
                  {m.label} — Pago
                </li>
              ))}
            </ul>
          </div>
        ) : view.monthsEmptyLabel ? (
          <div>
            <p className="text-sm font-medium mb-1">Meses liberados</p>
            <p className="text-sm text-muted-foreground uppercase tracking-wide">{view.monthsEmptyLabel}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
