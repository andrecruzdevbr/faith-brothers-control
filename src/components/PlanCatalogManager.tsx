import { useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/api";
import {
  EMPTY_CATALOG_DRAFT,
  audienceLabel,
  buildCatalogPlanWrite,
  catalogPlanDisplayAmount,
  catalogPlanEditBlockReason,
  draftFromCatalogPlan,
  type CatalogEditorDraft,
  type CatalogPlanRecord,
} from "@/lib/plan-catalog-editor";

type Props = { academyId: string };

/**
 * ADM catalog editor: when client provides veteran/period prices,
 * configure here without code or migration changes.
 * Family and drop-in plans are blocked — never coerced to new_student/Asaas monthly.
 */
export function PlanCatalogManager({ academyId }: Props) {
  const { toast } = useToast();
  const [plans, setPlans] = useState<CatalogPlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<CatalogEditorDraft>(EMPTY_CATALOG_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingPlan = editingId ? plans.find((plan) => plan.id === editingId) ?? null : null;

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("plans")
      .select(
        "id, name, audience, plan_kind, training_days_per_week, monthly_price, package_total_amount, duration_months, billing_mode, allows_installments, max_installments, reference_monthly_price, active",
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
          reference_monthly_price:
            p.reference_monthly_price == null ? null : Number(p.reference_monthly_price),
        })),
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academyId]);

  const startEdit = (plan: CatalogPlanRecord) => {
    const next = draftFromCatalogPlan(plan);
    if ("blocked" in next) {
      toast({ title: "Edição indisponível", description: next.blocked, variant: "destructive" });
      return;
    }
    setEditingId(plan.id);
    setDraft(next);
  };

  const save = async () => {
    const write = buildCatalogPlanWrite({
      mode: editingId ? "update" : "create",
      academyId,
      draft,
      original: editingPlan,
    });
    if ("blocked" in write) {
      toast({
        title: write.blocked === "Informe o nome do plano" || write.blocked === "Informe um valor válido"
          ? write.blocked
          : "Não foi possível salvar",
        description:
          write.blocked === "Informe um valor válido"
            ? "Não use R$ 0. Aguarde o valor do cliente se ainda não houver."
            : write.blocked,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("plans").update(write.payload).eq("id", editingId);
        if (error) throw error;
        toast({ title: "Plano atualizado" });
      } else {
        const { error } = await supabase.from("plans").insert(write.payload);
        if (error) throw error;
        toast({ title: "Plano cadastrado" });
      }
      setDraft(EMPTY_CATALOG_DRAFT);
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
          informar o valor. Planos familiares oficiais não são editáveis aqui.
        </p>
      </div>

      <div className="p-5 space-y-4 border-b border-border">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Público</Label>
            <Select
              value={draft.audience}
              disabled={!!editingId}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, audience: v as CatalogEditorDraft["audience"] }))
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
              disabled={!!editingId}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, plan_kind: v as CatalogEditorDraft["plan_kind"] }))
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
              disabled={!!editingId}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  training_days_per_week: v as CatalogEditorDraft["training_days_per_week"],
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
                setDraft(EMPTY_CATALOG_DRAFT);
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
                const amount = catalogPlanDisplayAmount(p);
                const blockReason = catalogPlanEditBlockReason(p);
                return (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="px-4 py-3 text-sm">{audienceLabel(p.audience)}</td>
                    <td className="px-4 py-3 text-sm">
                      {p.name}
                      <span className="block text-xs text-muted-foreground">
                        {p.plan_kind} · {p.training_days_per_week ?? "—"} dias
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{formatCurrency(amount)}</td>
                    <td className="px-4 py-3 text-sm">{p.active ? "Sim" : "Não"}</td>
                    <td className="px-4 py-3 text-sm">
                      {blockReason ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(p)}
                          title={blockReason}
                        >
                          Indisponível
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                          Editar
                        </Button>
                      )}
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
