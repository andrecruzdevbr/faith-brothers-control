import { useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatPlanOptionLabel, type PlanOption } from "@/lib/plans";

const NONE_VALUE = "__none__";

type StudentPlanEditorProps = {
  studentId: string;
  academyId: string;
  currentPlanId?: string | null;
  /** Admin altera direto; professor/aluno só solicitam (fica pendente). */
  mode?: "admin" | "request";
  allowRemove?: boolean;
  onSaved?: () => void;
};

export function StudentPlanEditor({
  studentId,
  academyId,
  currentPlanId = null,
  mode = "admin",
  allowRemove = true,
  onSaved,
}: StudentPlanEditorProps) {
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selected, setSelected] = useState<string>(currentPlanId ?? NONE_VALUE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isRequestMode = mode === "request";

  useEffect(() => {
    setSelected(currentPlanId ?? NONE_VALUE);
  }, [currentPlanId]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_public_active_plans", {
        _academy_id: academyId,
      });

      if (error) {
        toast({
          title: "Não foi possível carregar planos",
          description: error.message,
          variant: "destructive",
        });
        setPlans([]);
      } else {
        setPlans(
          (data ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            monthly_price: Number(p.monthly_price),
            training_days_per_week: p.training_days_per_week,
          })),
        );
      }
      setLoading(false);
    };
    void load();
  }, [academyId, toast]);

  const handleSave = async () => {
    if (isRequestMode) {
      if (!selected || selected === NONE_VALUE) {
        toast({
          title: "Selecione o novo plano",
          variant: "destructive",
        });
        return;
      }
      if (selected === currentPlanId) {
        toast({
          title: "O aluno já está neste plano",
          variant: "destructive",
        });
        return;
      }

      setSaving(true);
      const { error } = await supabase.rpc("request_student_plan_change", {
        _student_id: studentId,
        _requested_plan_id: selected,
      });

      if (error) {
        toast({
          title: "Não foi possível solicitar a mudança",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Mudança de plano solicitada",
          description: "Aguardando aprovação do administrador.",
        });
        onSaved?.();
      }
      setSaving(false);
      return;
    }

    setSaving(true);
    const planId = selected === NONE_VALUE ? null : selected;
    const { error } = await supabase.rpc("update_student_plan", {
      _student_id: studentId,
      _plan_id: planId,
    });

    if (error) {
      toast({
        title: "Não foi possível salvar o plano",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: planId ? "Plano atualizado" : "Plano removido",
        description: planId
          ? "O aluno está vinculado ao plano escolhido."
          : "O aluno ficou sem plano vinculado.",
      });
      onSaved?.();
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando planos...
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
        Cadastre um plano ativo antes de vincular.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="h-4 w-4 text-primary" />
          {isRequestMode ? "Solicitar mudança de plano" : "Plano financeiro do aluno"}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {isRequestMode
            ? "A solicitação fica pendente até o administrador aprovar. A cobrança Asaas continua no plano atual."
            : "Alteração imediata. Cobrança Asaas usa apenas o plano aprovado em students.plan_id."}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground" htmlFor={`plan-${studentId}`}>
          {isRequestMode ? "Novo plano" : "Plano"}
        </label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id={`plan-${studentId}`}>
            <SelectValue placeholder="Selecione um plano" />
          </SelectTrigger>
          <SelectContent>
            {!isRequestMode && allowRemove ? (
              <SelectItem value={NONE_VALUE}>Sem plano</SelectItem>
            ) : null}
            {plans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {formatPlanOptionLabel(plan)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="button" onClick={() => void handleSave()} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {saving
          ? "Salvando..."
          : isRequestMode
            ? "Solicitar mudança"
            : "Salvar plano"}
      </Button>
    </div>
  );
}
