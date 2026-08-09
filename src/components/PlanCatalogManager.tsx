import { useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/api";

type CatalogPlan = {
  id: string;
  name: string;
  audience: string;
  plan_kind: string;
  training_days_per_week: number | null;
  monthly_price: number;
  package_total_amount: number | null;
  duration_months: number | null;
  billing_mode: string | null;
  active: boolean;
};

type Draft = {
  name: string;
  audience: "new_student" | "veterano";
  plan_kind: "mensal" | "trimestral" | "semestral" | "anual";
  training_days_per_week: "1" | "2" | "3" | "5";
  price: string;
  active: "true" | "false";
};

const EMPTY_DRAFT: Draft = {
  name: "",
  audience: "veterano",
  plan_kind: "mensal",
  training_days_per_week: "3",
  price: "",
  active: "false",
};

function billingDefaults(kind: Draft["plan_kind"]): {
  billing_mode: string;
  duration_months: number;
  allows_installments: boolean;
} {
  if (kind === "mensal") {
    return { billing_mode: "asaas_monthly", duration_months: 1, allows_installments: false };
  }
  const duration = kind === "trimestral" ? 3 : kind === "semestral" ? 6 : 12;
  return { billing_mode: "machine_prepaid", duration_months: duration, allows_installments: true };
}

type Props = { academyId: string };

/**
 * ADM catalog editor: when client provides veteran/period prices,
 * configure here without code or migration changes.
 */
export function PlanCatalogManager({ academyId }: Props) {
  const { toast } = useToast();
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("plans")
      .select(
        "id, name, audience, plan_kind, training_days_per_week, monthly_price, package_total_amount, duration_months, billing_mode, active",
      )
      .eq("academy_id", academyId)
      .order("audience")
      .order("plan_kind")
      .order("training_days_per_week");
    if (error) {
      toast({ title: "Erro ao carregar catálogo", description: error.message, variant: "destructive" });
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
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academyId]);

  const startEdit = (plan: CatalogPlan) => {
    setEditingId(plan.id);
    const amount =
      plan.billing_mode === "machine_prepaid" || plan.billing_mode === "machine_dropin"
        ? Number(plan.package_total_amount ?? plan.monthly_price)
        : Number(plan.monthly_price);
    setDraft({
      name: plan.name,
      audience: plan.audience === "veterano" ? "veterano" : "new_student",
      plan_kind:
        plan.plan_kind === "trimestral" ||
        plan.plan_kind === "semestral" ||
        plan.plan_kind === "anual" ||
        plan.plan_kind === "mensal"
          ? plan.plan_kind
          : "mensal",
      training_days_per_week:
        plan.training_days_per_week === 1 ||
        plan.training_days_per_week === 2 ||
        plan.training_days_per_week === 5
          ? (String(plan.training_days_per_week) as "1" | "2" | "5")
          : "3",
      price: String(amount),
      active: plan.active ? "true" : "false",
    });
  };

  const save = async () => {
    const price = Number(String(draft.price).replace(",", "."));
    if (!draft.name.trim()) {
      toast({ title: "Informe o nome do plano", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast({
        title: "Informe um valor válido",
        description: "Não use R$ 0. Aguarde o valor do cliente se ainda não houver.",
        variant: "destructive",
      });
      return;
    }

    const defaults = billingDefaults(draft.plan_kind);
    const days = Number(draft.training_days_per_week);
    const payload = {
      academy_id: academyId,
      name: draft.name.trim(),
      audience: draft.audience,
      plan_kind: draft.plan_kind,
      training_days_per_week: days,
      duration_months: defaults.duration_months,
      billing_mode: defaults.billing_mode,
      allows_installments: defaults.allows_installments,
      max_installments: defaults.allows_installments ? 12 : 1,
      active: draft.active === "true",
      monthly_price:
        defaults.billing_mode === "asaas_monthly"
          ? price
          : Math.round((price / defaults.duration_months) * 100) / 100,
      reference_monthly_price:
        defaults.billing_mode === "asaas_monthly"
          ? price
          : Math.round((price / defaults.duration_months) * 100) / 100,
      package_total_amount:
        defaults.billing_mode === "asaas_monthly" ? null : price,
    };

    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("plans").update(payload).eq("id", editingId);
        if (error) throw error;
        toast({ title: "Plano atualizado" });
      } else {
        const { error } = await supabase.from("plans").insert(payload);
        if (error) throw error;
        toast({ title: "Plano cadastrado" });
      }
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      await reload();
    } catch (e) {
      toast({
        title: "Não foi possível salvar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      <div className="p-5 border-b border-border">
        <h3 className="font-display text-lg font-bold tracking-wider">CATÁLOGO COMERCIAL</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Cadastre/ative planos New Student e Veterano com valores oficiais. Sem inventar preço.
          Veterano mensal/trimestral/semestral/anual ficam prontos para ativar quando o cliente
          informar o valor.
        </p>
      </div>

      <div className="p-5 space-y-4 border-b border-border">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Público</Label>
            <Select
              value={draft.audience}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, audience: v as Draft["audience"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_student">Novo aluno</SelectItem>
                <SelectItem value="veterano">Veterano</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Plano</Label>
            <Select
              value={draft.plan_kind}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, plan_kind: v as Draft["plan_kind"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mensal">Mensal (2/3/5)</SelectItem>
                <SelectItem value="trimestral">Trimestral</SelectItem>
                <SelectItem value="semestral">Semestral</SelectItem>
                <SelectItem value="anual">Anual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Frequência</Label>
            <Select
              value={draft.training_days_per_week}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  training_days_per_week: v as Draft["training_days_per_week"],
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 dia</SelectItem>
                <SelectItem value="2">2 dias</SelectItem>
                <SelectItem value="3">3 dias</SelectItem>
                <SelectItem value="5">5 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Ex.: Plano Veterano Mensal 3 dias"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
              placeholder="Somente valor oficial do cliente"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ativo</Label>
            <Select
              value={draft.active}
              onValueChange={(v) => setDraft((d) => ({ ...d, active: v as "true" | "false" }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Sim</SelectItem>
                <SelectItem value="false">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editingId ? "Salvar alterações" : "Cadastrar plano"}
          </Button>
          {editingId ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY_DRAFT);
              }}
            >
              Cancelar edição
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando catálogo…
          </div>
        ) : plans.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nenhum plano no catálogo.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">
                  Público
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">
                  Plano
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">
                  Valor
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">
                  Ativo
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const amount =
                  p.billing_mode === "machine_prepaid" || p.billing_mode === "machine_dropin"
                    ? Number(p.package_total_amount ?? p.monthly_price)
                    : Number(p.monthly_price);
                return (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="px-4 py-3 text-sm">{p.audience}</td>
                    <td className="px-4 py-3 text-sm">
                      {p.name}
                      <span className="block text-xs text-muted-foreground">
                        {p.plan_kind} · {p.training_days_per_week ?? "—"} dias
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{formatCurrency(amount)}</td>
                    <td className="px-4 py-3 text-sm">{p.active ? "Sim" : "Não"}</td>
                    <td className="px-4 py-3 text-sm">
                      <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                        Editar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
