import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  DollarSign, TrendingUp, AlertCircle, CheckCircle, MessageCircle,
  ChevronLeft, ChevronRight, Loader2, ExternalLink,
} from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  useAcademyId, useBillings, usePlans, useDashboardStats, useAcademySettings,
} from "@/hooks/useQueries";
import { callEdgeFunction, formatCurrency, formatDateBR } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { BILLING_STATUS_LABELS, PAGE_SIZE } from "@/lib/constants";

const statusStyles: Record<string, { label: string; class: string }> = {
  pago: { label: "Pago", class: "text-success bg-success/10" },
  vencido: { label: "Vencido", class: "text-destructive bg-destructive/10" },
  pendente: { label: "Pendente", class: "text-warning bg-warning/10" },
  gerado: { label: "Gerado", class: "text-warning bg-warning/10" },
  enviado_whatsapp: { label: "Enviado", class: "text-primary bg-primary/10" },
  cancelado: { label: "Cancelado", class: "text-muted-foreground bg-secondary" },
  falhou: { label: "Falhou", class: "text-destructive bg-destructive/10" },
};

const Financeiro = () => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: academyId } = useAcademyId();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const { data: stats, isLoading: loadingStats } = useDashboardStats();
  const { data: plans, isLoading: loadingPlans } = usePlans();
  const { data: settings, isLoading: loadingSettings } = useAcademySettings();
  const { data: billingsData, isLoading: loadingBillings, isFetching } = useBillings(page, statusFilter);

  const billings = billingsData?.billings ?? [];
  const total = billingsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: financeExtras, isLoading: loadingExtras } = useQuery({
    queryKey: ["finance-extras", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

      const [{ data: receivable }, { count: paidCount }] = await Promise.all([
        supabase
          .from("billings")
          .select("amount")
          .eq("academy_id", academyId!)
          .in("status", ["pendente", "gerado", "enviado_whatsapp"]),
        supabase
          .from("billings")
          .select("id", { count: "exact", head: true })
          .eq("academy_id", academyId!)
          .eq("status", "pago")
          .gte("reference_month", monthStart),
      ]);

      const aReceber = (receivable ?? []).reduce((s, b) => s + Number(b.amount), 0);
      return { aReceber, paidCount: paidCount ?? 0 };
    },
  });

  const { data: planCounts } = useQuery({
    queryKey: ["plan-student-counts", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("plan_id")
        .eq("academy_id", academyId!)
        .eq("status", "ativo");
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const s of data ?? []) {
        if (s.plan_id) counts.set(s.plan_id, (counts.get(s.plan_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const handleResendWhatsApp = async (billingId: string) => {
    setSendingId(billingId);
    try {
      await callEdgeFunction("send-billing-whatsapp", { billingId });
      toast({ title: "WhatsApp enviado", description: "A cobrança foi reenviada ao aluno." });
      await queryClient.invalidateQueries({ queryKey: ["billings"] });
    } catch (e) {
      toast({
        title: "Erro ao enviar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSendingId(null);
    }
  };

  const academy = settings?.academy;
  const billingSettings = settings?.billing;
  const loading = loadingStats || loadingExtras;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">FINANCEIRO</h1>
        <p className="text-sm text-muted-foreground mt-1">Gestão de cobranças e planos</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Faturamento Mês" value={formatCurrency(stats?.monthRevenue ?? 0)} icon={DollarSign} variant="primary" />
          <StatsCard title="A Receber" value={formatCurrency(financeExtras?.aReceber ?? 0)} icon={TrendingUp} variant="warning" />
          <StatsCard title="Inadimplentes" value={stats?.overdueCount ?? 0} icon={AlertCircle} variant="destructive" />
          <StatsCard title="Pagos no Mês" value={financeExtras?.paidCount ?? 0} icon={CheckCircle} variant="success" />
        </div>
      )}

      <div>
        <h3 className="font-display text-lg font-bold tracking-wider mb-4">PLANOS</h3>
        {loadingPlans ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (plans ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum plano cadastrado.</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(plans ?? []).map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className="rounded-xl border border-border bg-card p-4 shadow-card"
              >
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{p.name}</p>
                <p className="text-2xl font-display font-bold text-primary mt-1">{formatCurrency(Number(p.monthly_price))}</p>
                <p className="text-xs text-muted-foreground mt-1">{planCounts?.get(p.id) ?? 0} alunos</p>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { value: undefined, label: "Todos" },
          { value: "pago", label: "Pagos" },
          { value: "vencido", label: "Vencidos" },
          { value: "pendente", label: "Pendentes" },
        ].map((f) => (
          <button
            key={f.label}
            onClick={() => { setStatusFilter(f.value); setPage(1); }}
            className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
              statusFilter === f.value
                ? "gradient-primary text-primary-foreground border-primary"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
      >
        <div className="p-5 border-b border-border">
          <h3 className="font-display text-lg font-bold tracking-wider">COBRANÇAS</h3>
        </div>

        {loadingBillings ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : billings.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma cobrança encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Aluno</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Plano</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Valor</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Vencimento</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  {isAdmin && (
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ações</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {billings.map((b) => {
                  const student = Array.isArray(b.students) ? b.students[0] : b.students;
                  const plan = Array.isArray(b.plans) ? b.plans[0] : b.plans;
                  const s = statusStyles[b.status] ?? { label: BILLING_STATUS_LABELS[b.status] ?? b.status, class: "text-muted-foreground bg-secondary" };
                  const canResend = isAdmin && b.status !== "pago" && b.status !== "cancelado";

                  return (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-foreground">{student?.full_name ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{plan?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-sm font-display font-bold text-foreground">{formatCurrency(Number(b.amount))}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{formatDateBR(b.due_date)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${s.class}`}>{s.label}</span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {b.boleto_url && (
                              <a
                                href={b.boleto_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" /> Boleto
                              </a>
                            )}
                            {canResend && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                disabled={sendingId === b.id}
                                onClick={() => void handleResendWhatsApp(b.id)}
                              >
                                {sendingId === b.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <MessageCircle className="h-3 w-3" />
                                )}
                                WhatsApp
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loadingBillings && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Página {page} de {totalPages} • {total} registros
              {isFetching && !loadingBillings && " • Atualizando..."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Próxima <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-xl border border-border bg-card p-5 shadow-card"
      >
        <h3 className="font-display text-lg font-bold tracking-wider mb-3">DADOS BANCÁRIOS</h3>
        {loadingSettings ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-muted-foreground">Banco:</span> <span className="text-foreground font-medium">{academy?.bank_name || "—"}</span></div>
              <div><span className="text-muted-foreground">Código:</span> <span className="text-foreground font-medium">{academy?.bank_code || "—"}</span></div>
              <div><span className="text-muted-foreground">Agência:</span> <span className="text-foreground font-medium">{academy?.bank_branch || "—"}</span></div>
              <div><span className="text-muted-foreground">Conta:</span> <span className="text-foreground font-medium">{academy?.bank_account || "—"}</span></div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Responsável: {academy?.finance_contact_name || "—"}
              {academy?.finance_whatsapp && ` • WhatsApp: ${academy.finance_whatsapp}`}
            </p>
            {billingSettings && (
              <p className="text-xs text-muted-foreground mt-1">
                Emissão dia {billingSettings.boleto_issue_day} • Vencimento dia {billingSettings.boleto_due_day}
                {billingSettings.send_whatsapp_automatically ? " • Envio automático ativo" : " • Envio manual"}
              </p>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
};

export default Financeiro;
