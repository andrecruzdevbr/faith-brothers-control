import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PREPAID_PAYMENT_METHOD_LABELS,
  formatCoverageMonthLabel,
  maskTaxId,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";
import { formatCurrency, formatDateBR } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  studentId: string;
};

export function StudentContractOverview({ studentId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["student-contract-overview", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data: months, error: monthsError } = await supabase
        .from("student_contract_months" as never)
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

      const contractId = monthRows.find((m) => m.status === "pago")?.contract_id
        ?? monthRows[0]?.contract_id
        ?? null;

      let contract: {
        id: string;
        starts_on: string;
        ends_on: string;
        weekly_frequency: number | null;
        total_amount: number;
        payment_method: string;
        installments: number;
        contract_status: string;
        payment_status: string;
        family_group_id: string | null;
        student_id: string | null;
        plans?: { name?: string | null } | null;
      } | null = null;

      if (contractId) {
        const { data: c } = await supabase
          .from("student_contracts" as never)
          .select(
            "id, starts_on, ends_on, weekly_frequency, total_amount, payment_method, installments, contract_status, payment_status, family_group_id, student_id, plans(name)",
          )
          .eq("id", contractId)
          .maybeSingle();
        contract = c as typeof contract;
      }

      let family: {
        name: string;
        financial_responsible_name: string;
        financial_responsible_tax_id: string | null;
      } | null = null;
      let relationship: string | null = null;

      const { data: fm } = await supabase
        .from("family_members" as never)
        .select(
          "relationship, status, family_groups(name, financial_responsible_name, financial_responsible_tax_id)",
        )
        .eq("student_id", studentId)
        .in("status", ["ativo", "pendente"])
        .limit(1)
        .maybeSingle();

      if (fm) {
        const row = fm as {
          relationship: string;
          family_groups:
            | {
                name: string;
                financial_responsible_name: string;
                financial_responsible_tax_id: string | null;
              }
            | {
                name: string;
                financial_responsible_name: string;
                financial_responsible_tax_id: string | null;
              }[]
            | null;
        };
        const g = Array.isArray(row.family_groups) ? row.family_groups[0] : row.family_groups;
        relationship = row.relationship;
        if (g) family = g;
      }

      return { monthRows, contract, family, relationship };
    },
  });

  if (isLoading) {
    return <Skeleton className="h-40 rounded-xl" />;
  }

  if (!data?.contract && (!data?.monthRows || data.monthRows.length === 0) && !data?.family) {
    return null;
  }

  const paidMonths = (data?.monthRows ?? []).filter((m) => m.status === "pago");
  const isFamilyPay = Boolean(data?.contract?.family_group_id) || paidMonths.some((m) => m.source === "family");
  const planName = Array.isArray(data?.contract?.plans)
    ? data?.contract?.plans[0]?.name
    : data?.contract?.plans?.name;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-bold tracking-wide">Contrato / cobertura</h2>
      </div>

      {data?.family ? (
        <div className="text-sm space-y-1">
          <p>
            <span className="text-muted-foreground">Grupo familiar:</span> {data.family.name}
          </p>
          <p>
            <span className="text-muted-foreground">Parentesco:</span> {data.relationship ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Responsável financeiro:</span>{" "}
            {data.family.financial_responsible_name}
          </p>
          <p>
            <span className="text-muted-foreground">CPF:</span>{" "}
            {maskTaxId(data.family.financial_responsible_tax_id)}
          </p>
        </div>
      ) : null}

      {data?.contract ? (
        <div className="text-sm space-y-1">
          <p>
            <span className="text-muted-foreground">Contrato:</span> {planName ?? "Pacote"} ·{" "}
            {data.contract.contract_status} / {data.contract.payment_status}
          </p>
          <p>
            <span className="text-muted-foreground">Período:</span>{" "}
            {formatDateBR(data.contract.starts_on)} — {formatDateBR(data.contract.ends_on)}
          </p>
          <p>
            <span className="text-muted-foreground">Frequência individual:</span>{" "}
            {data.contract.weekly_frequency ?? "—"} dias/semana
          </p>
          <p>
            {isFamilyPay
              ? "Pagamento realizado pelo responsável financeiro"
              : `Pagamento individual · ${
                  PREPAID_PAYMENT_METHOD_LABELS[
                    data.contract.payment_method as PrepaidPaymentMethod
                  ] ?? data.contract.payment_method
                }`}
          </p>
          {!isFamilyPay ? (
            <p className="text-xs text-muted-foreground">
              Total do pacote: {formatCurrency(Number(data.contract.total_amount))} ·{" "}
              {data.contract.installments}x (metadado maquininha)
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Detalhes financeiros completos ficam com o responsável / administração.
            </p>
          )}
        </div>
      ) : null}

      {paidMonths.length > 0 ? (
        <div>
          <p className="text-sm font-medium mb-2">Meses cobertos</p>
          <ul className="grid gap-1 sm:grid-cols-2 text-sm">
            {paidMonths.map((m) => (
              <li key={m.id} className="rounded-md bg-success/10 text-success px-2 py-1">
                {formatCoverageMonthLabel(m.reference_month)} —{" "}
                {m.source === "family" ? "Pago pelo contrato familiar" : "Pago (pacote)"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
