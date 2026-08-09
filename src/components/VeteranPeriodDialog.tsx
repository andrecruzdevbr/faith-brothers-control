import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/lib/api";
import {
  BILLING_PERIOD_LABELS,
  type BillingPeriodChoice,
} from "@/lib/registration-flows";
import { PREPAID_PAYMENT_METHOD_LABELS, type PrepaidPaymentMethod } from "@/lib/prepaid-contracts";
import { useToast } from "@/hooks/use-toast";

type Props = {
  student: {
    id: string;
    full_name: string;
    requested_training_days?: number | null;
  };
  onDone: () => void;
};

export function VeteranPeriodDialog({ student, onDone }: Props) {
  const { toast } = useToast();
  const [period, setPeriod] = useState<BillingPeriodChoice | "">("");
  const [paymentMethod, setPaymentMethod] = useState<PrepaidPaymentMethod>("cartao_credito");
  const [installments, setInstallments] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  const onConfirm = async () => {
    if (!period) {
      toast({ title: "Selecione a modalidade", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("set_veteran_billing_period", {
        _student_id: student.id,
        _period: period,
        _payment_method: period === "mensal" ? "boleto" : paymentMethod,
        _installments: period === "mensal" ? null : Number(installments || 1),
      });
      if (error) throw error;

      if (period !== "mensal") {
        toast({
          title: "Modalidade definida",
          description: "Aguardando confirmação do pagamento na maquininha pelo administrador.",
        });
      } else {
        try {
          await callEdgeFunction(
            "notify-registration-event",
            { student_id: student.id, event: "approved" },
            { requireAuth: true },
          );
        } catch {
          /* WA optional */
        }
        toast({
          title: "Modalidade mensal ativada",
          description: "Aluno ativo. Cobrança Asaas seguirá o calendário configurado.",
        });
      }
      onDone();
    } catch (e) {
      toast({
        title: "Não foi possível definir a modalidade",
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
        <p className="font-medium">{student.full_name}</p>
        <p className="text-sm text-muted-foreground">
          Frequência: {student.requested_training_days ?? "—"} dias/semana
        </p>
      </div>

      <div className="space-y-2">
        <Label>Modalidade</Label>
        <Select value={period || undefined} onValueChange={(v) => setPeriod(v as BillingPeriodChoice)}>
          <SelectTrigger>
            <SelectValue placeholder="Mensal / Semestral / Anual" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(BILLING_PERIOD_LABELS) as BillingPeriodChoice[]).map((key) => (
              <SelectItem key={key} value={key}>
                {BILLING_PERIOD_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period === "semestral" || period === "anual" ? (
        <>
          <div className="space-y-2">
            <Label>Forma na maquininha</Label>
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
            Cartão nunca é considerado pago automaticamente. Use “Revisar pagamento” depois.
          </p>
        </>
      ) : null}

      <Button className="w-full" disabled={submitting || !period} onClick={() => void onConfirm()}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Confirmar modalidade
      </Button>
    </div>
  );
}
