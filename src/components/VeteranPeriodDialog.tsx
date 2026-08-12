import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { PlanOption } from "@/lib/plans";
import {
  BILLING_PERIOD_LABELS,
  MONTHLY_PAYMENT_LABELS,
  MONTHLY_PAYMENT_OPTIONS,
  VETERAN_AWAITING_PRICE_MESSAGE,
  formatVeteranPrepaidPriceSummary,
  listConfiguredVeteranPeriods,
  matchVeteranPlan,
  paymentMethodsForVeteranMonthly,
  type BillingPeriodChoice,
  type MonthlyPaymentOption,
  type VeteranTrainingDays,
  validateVeteranTrainingDays,
} from "@/lib/registration-flows";
import { formatCurrency } from "@/lib/api";
import { PREPAID_PAYMENT_METHOD_LABELS, type PrepaidPaymentMethod } from "@/lib/prepaid-contracts";
import { useToast } from "@/hooks/use-toast";

type Props = {
  student: {
    id: string;
    full_name: string;
    academy_id?: string | null;
    requested_training_days?: number | null;
  };
  onDone: () => void;
};

export function VeteranPeriodDialog({ student, onDone }: Props) {
  const { toast } = useToast();
  const [period, setPeriod] = useState<BillingPeriodChoice | "">("");
  const [monthlyPayment, setMonthlyPayment] = useState<MonthlyPaymentOption>("boleto");
  const [paymentMethod, setPaymentMethod] = useState<PrepaidPaymentMethod>("cartao_credito");
  const [installments, setInstallments] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const trainingDays = student.requested_training_days;
  const daysOk = validateVeteranTrainingDays(trainingDays);

  useEffect(() => {
    const load = async () => {
      setLoadingPlans(true);
      let academyId = student.academy_id ?? null;
      if (!academyId) {
        const { data } = await supabase
          .from("students")
          .select("academy_id")
          .eq("id", student.id)
          .maybeSingle();
        academyId = data?.academy_id ?? null;
      }
      if (!academyId) {
        setPlans([]);
        setLoadingPlans(false);
        return;
      }
      const { data, error } = await supabase
        .from("plans")
        .select(
          "id, name, monthly_price, training_days_per_week, audience, plan_kind, duration_months, package_total_amount, billing_mode, allows_installments, max_installments",
        )
        .eq("academy_id", academyId)
        .eq("active", true);
      if (error) {
        toast({
          title: "Não foi possível carregar planos veterano",
          description: error.message,
          variant: "destructive",
        });
        setPlans([]);
      } else {
        setPlans(
          (data ?? []).map((p) => ({
            ...p,
            monthly_price: Number(p.monthly_price),
            package_total_amount:
              p.package_total_amount == null ? null : Number(p.package_total_amount),
          })),
        );
      }
      setLoadingPlans(false);
    };
    void load();
  }, [student.academy_id, student.id, toast]);

  const matchedPlan = useMemo(() => {
    if (!period || !daysOk) return null;
    return matchVeteranPlan({
      plans,
      trainingDays: trainingDays as VeteranTrainingDays,
      period,
    });
  }, [period, daysOk, plans, trainingDays]);

  const configuredPeriods = useMemo(
    () => listConfiguredVeteranPeriods({ plans, trainingDays }),
    [plans, trainingDays],
  );

  useEffect(() => {
    if (period && configuredPeriods.length > 0 && !configuredPeriods.includes(period)) {
      setPeriod("");
    }
  }, [period, configuredPeriods]);

  const awaitingPrice = !!period && daysOk && !matchedPlan && !loadingPlans;
  const noConfiguredPlans = !loadingPlans && daysOk && configuredPeriods.length === 0;
  const isPrepaidPeriod =
    period === "trimestral" || period === "semestral" || period === "anual";
  const isMensal = period === "mensal";
  const monthlyOptions = paymentMethodsForVeteranMonthly();

  const onConfirm = async () => {
    if (!period) {
      toast({ title: "Selecione o plano", variant: "destructive" });
      return;
    }
    if (!matchedPlan) {
      toast({
        title: VETERAN_AWAITING_PRICE_MESSAGE,
        description: "Cadastre o valor no catálogo de planos (público Veterano) antes de gerar cobrança.",
        variant: "destructive",
      });
      return;
    }
    if (isMensal && !MONTHLY_PAYMENT_OPTIONS.includes(monthlyPayment)) {
      toast({ title: "Selecione boleto ou cartão", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const method = isMensal ? monthlyPayment : paymentMethod;
      const { error } = await supabase.rpc("set_veteran_billing_period", {
        _student_id: student.id,
        _period: period,
        _payment_method: method,
        _installments:
          isMensal && monthlyPayment === "boleto"
            ? null
            : method === "cartao_credito"
              ? Number(installments || 1)
              : 1,
      });
      if (error) throw error;

      if (isPrepaidPeriod || (isMensal && monthlyPayment === "cartao_credito")) {
        toast({
          title: "Plano definido",
          description: "Aguardando confirmação do pagamento na maquininha pelo administrador.",
        });
      } else {
        toast({
          title: "Plano mensal veterano ativado",
          description: "Aluno ativo. Cobrança Asaas (boleto) seguirá o calendário configurado.",
        });
      }
      onDone();
    } catch (e) {
      toast({
        title: "Não foi possível definir o plano",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">Veterano aprovado</p>
        <p className="text-sm text-muted-foreground">{student.full_name}</p>
        <p className="text-sm text-muted-foreground">
          Frequência desejada: {student.requested_training_days ?? "—"} dias
        </p>
      </div>

      <div className="space-y-2">
        <Label>Plano</Label>
        <Select
          value={period || undefined}
          onValueChange={(v) => setPeriod(v as BillingPeriodChoice)}
          disabled={loadingPlans || configuredPeriods.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                loadingPlans
                  ? "Carregando..."
                  : configuredPeriods.length === 0
                    ? "Nenhum plano oficial disponível"
                    : "Mensal / Trimestral / Semestral / Anual"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {configuredPeriods.map((key) => (
              <SelectItem key={key} value={key}>
                {BILLING_PERIOD_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {matchedPlan ? (
        <div className="text-sm rounded-md border border-border bg-secondary/40 p-2 space-y-1">
          <p className="font-medium">{matchedPlan.name}</p>
          {isPrepaidPeriod ? (
            <p className="text-muted-foreground">
              {formatVeteranPrepaidPriceSummary(matchedPlan)}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {formatCurrency(Number(matchedPlan.monthly_price))} / mês
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Frequência do aluno permanece: {student.requested_training_days ?? "—"} dias/semana
            {isPrepaidPeriod ? " (não altera o preço da fidelidade)" : ""}
          </p>
        </div>
      ) : null}

      {noConfiguredPlans ? (
        <p className="text-sm text-amber-700 dark:text-amber-400 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          {VETERAN_AWAITING_PRICE_MESSAGE}
        </p>
      ) : null}

      {awaitingPrice ? (
        <p className="text-sm text-amber-700 dark:text-amber-400 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          {VETERAN_AWAITING_PRICE_MESSAGE}
        </p>
      ) : null}

      {isMensal && matchedPlan ? (
        <div className="space-y-2">
          <Label>Forma de pagamento</Label>
          <Select
            value={monthlyPayment}
            onValueChange={(v) => setMonthlyPayment(v as MonthlyPaymentOption)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Boleto ou cartão" />
            </SelectTrigger>
            <SelectContent>
              {monthlyOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {MONTHLY_PAYMENT_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {monthlyPayment === "boleto" ? (
            <p className="text-xs text-muted-foreground">
              Boleto Asaas: cobrança mensal conforme calendário. Sem confirmação de maquininha.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Cartão nunca é considerado pago automaticamente. Use “Pagamento aprovado” depois.
              Nenhum boleto Asaas será gerado.
            </p>
          )}
        </div>
      ) : null}

      {isPrepaidPeriod && matchedPlan ? (
        <>
          <div className="space-y-2">
            <Label>Forma de pagamento</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PrepaidPaymentMethod)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PREPAID_PAYMENT_METHOD_LABELS) as PrepaidPaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {PREPAID_PAYMENT_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {paymentMethod === "cartao_credito" ? (
            <div className="space-y-2">
              <Label>Parcelas</Label>
              <Select value={installments} onValueChange={setInstallments}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}x
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Cartão nunca é considerado pago automaticamente. Use “Pagamento aprovado” depois.
          </p>
        </>
      ) : null}

      <Button
        className="w-full"
        disabled={submitting || !period || !matchedPlan || loadingPlans}
        onClick={() => void onConfirm()}
      >
        {submitting || loadingPlans ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Confirmar plano e pagamento
      </Button>
    </div>
  );
}
