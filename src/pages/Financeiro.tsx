import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  DollarSign, TrendingUp, AlertCircle, CheckCircle, MessageCircle,
  ChevronLeft, ChevronRight, Loader2, ExternalLink, Receipt, Send,
} from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  useAcademyId, useBillings, usePlans, useDashboardStats, useAcademySettings,
} from "@/hooks/useQueries";
import { callEdgeFunction, formatCurrency, formatDateBR } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { BILLING_STATUS_LABELS, PAGE_SIZE } from "@/lib/constants";
import { formatBillingSettingsLabel, summarizeBillingRunText } from "@/lib/billing";

type BillingRunSummary = {
  created: number;
  alreadyExists: number;
  skippedMissingPlan: number;
  skippedMissingTaxId: number;
  skippedMissingWhatsApp: number;
  skippedBeforeIssueDay: number;
  skippedOther: number;
  whatsappSent: number;
  whatsappSkipped: number;
  errors: number;
};

type GenerateResponse = {
  success: boolean;
  referenceMonth?: string;
  summary?: BillingRunSummary;
  error?: string;
};

type SendResponse = {
  ok: boolean;
  summary?: BillingRunSummary;
  sent?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

const statusStyles: Record<string, { label: string; class: string }> = {
  pago: { label: "Pago", class: "text-success bg-success/10" },
  vencido: { label: "Vencido", class: "text-destructive bg-destructive/10" },
  pendente: { label: "Pendente", class: "text-warning bg-warning/10" },
  gerado: { label: "Gerado", class: "text-warning bg-warning/10" },
  enviado_whatsapp: { label: "Enviado", class: "text-primary bg-primary/10" },
  cancelado: { label: "Cancelado", class: "text-muted-foreground bg-secondary" },
  falhou: { label: "Falhou", class: "text-destructive bg-destructive/10" },
};

function currentReferenceMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

function summarizeText(summary: BillingRunSummary): string[] {
  return summarizeBillingRunText(summary);
}

const Financeiro = () => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: academyId } = useAcademyId();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    null | "generate" | "generate_send" | "send_pending"
  >(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLines, setSummaryLines] = useState<string[]>([]);
  const [resendBillingId, setResendBillingId] = useState<string | null>(null);

  const referenceMonth = useMemo(() => currentReferenceMonth(), []);

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

  const { data: eligibleStudents, isLoading: loadingEligible } = useQuery({
    queryKey: ["eligible-billing-students", academyId, referenceMonth],
    enabled: !!academyId && isAdmin,
    queryFn: async () => {
      const [{ data: students, error: studentsError }, { data: monthBillings, error: billingsError }] =
        await Promise.all([
          supabase
            .from("students")
            .select("id, full_name, whatsapp, plan_id, plans(name, monthly_price)")
            .eq("academy_id", academyId!)
            .eq("status", "ativo")
            .not("plan_id", "is", null)
            .order("full_name"),
          supabase
            .from("billings")
            .select("student_id")
            .eq("academy_id", academyId!)
            .eq("reference_month", referenceMonth),
        ]);
      if (studentsError) throw studentsError;
      if (billingsError) throw billingsError;
      const billed = new Set((monthBillings ?? []).map((b) => b.student_id));
      return (students ?? []).filter((s) => !billed.has(s.id));
    },
  });

  const invalidateFinance = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["billings"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-extras"] }),
      queryClient.invalidateQueries({ queryKey: ["eligible-billing-students"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
    ]);
  };

  const showSummary = (summary?: BillingRunSummary) => {
    if (!summary) return;
    setSummaryLines(summarizeText(summary));
    setSummaryOpen(true);
  };

  const runGenerate = async (sendWhatsApp: boolean) => {
    setBusyAction(sendWhatsApp ? "generate_send" : "generate");
    try {
      const data = await callEdgeFunction<GenerateResponse>("generate-monthly-billings", {
        force: true,
        sendWhatsApp,
      });
      showSummary(data.summary);
      toast({
        title: sendWhatsApp ? "Cobranças geradas e envio processado" : "Cobranças geradas",
        description: `Referência ${data.referenceMonth ?? referenceMonth}`,
      });
      await invalidateFinance();
    } catch (e) {
      toast({
        title: "Erro ao gerar cobranças",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
      setConfirmAction(null);
    }
  };

  const runSendPending = async () => {
    setBusyAction("send_pending");
    try {
      const data = await callEdgeFunction<SendResponse>("send-billing-whatsapp", {
        scope: "pending_month",
      });
      showSummary(data.summary);
      toast({
        title: "Envio coletivo processado",
        description: "Cobranças pendentes do mês foram processadas.",
      });
      await invalidateFinance();
    } catch (e) {
      toast({
        title: "Erro no envio coletivo",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
      setConfirmAction(null);
    }
  };

  const handleGenerateIndividual = async (studentId: string) => {
    setBusyAction(`student:${studentId}`);
    try {
      const data = await callEdgeFunction<GenerateResponse>("generate-monthly-billings", {
        force: true,
        sendWhatsApp: false,
        studentId,
      });
      showSummary(data.summary);
      toast({ title: "Cobrança individual processada" });
      await invalidateFinance();
    } catch (e) {
      toast({
        title: "Erro ao gerar cobrança",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleResendWhatsApp = async (billingId: string, alreadySent: boolean) => {
    if (alreadySent) {
      setResendBillingId(billingId);
      return;
    }
    await sendWhatsApp(billingId, false);
  };

  const sendWhatsApp = async (billingId: string, resend: boolean) => {
    setSendingId(billingId);
    try {
      const data = await callEdgeFunction<SendResponse>("send-billing-whatsapp", {
        billingId,
        resend,
      });
      if (data.skipped && !data.sent) {
        toast({
          title: "WhatsApp não enviado",
          description: data.reason ?? "Envio ignorado (safe mode ou destinatário inválido).",
        });
      } else {
        toast({ title: "WhatsApp enviado", description: "A cobrança foi enviada ao aluno." });
      }
      await invalidateFinance();
    } catch (e) {
      toast({
        title: "Erro ao enviar",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSendingId(null);
      setResendBillingId(null);
    }
  };

  const academy = settings?.academy;
  const billingSettings = settings?.billing;
  const loading = loadingStats || loadingExtras;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">FINANCEIRO</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestão de cobranças e planos • Vencimento dia 15</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="gap-2"
              disabled={!!busyAction}
              onClick={() => setConfirmAction("generate")}
            >
              {busyAction === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              Gerar cobranças do mês
            </Button>
            <Button
              className="gradient-primary text-primary-foreground gap-2"
              disabled={!!busyAction}
              onClick={() => setConfirmAction("generate_send")}
            >
              {busyAction === "generate_send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Gerar e enviar cobranças do mês
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              disabled={!!busyAction}
              onClick={() => setConfirmAction("send_pending")}
            >
              {busyAction === "send_pending" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="h-4 w-4" />
              )}
              Enviar WhatsApp para pendentes
            </Button>
          </div>
        )}
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

      {isAdmin && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
        >
          <div className="p-5 border-b border-border">
            <h3 className="font-display text-lg font-bold tracking-wider">GERAR COBRANÇA INDIVIDUAL</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Alunos ativos com plano e sem cobrança no mês ({formatDateBR(referenceMonth)}). Vencimento dia 15.
            </p>
          </div>
          {loadingEligible ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (eligibleStudents ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Todos os alunos elegíveis já possuem cobrança neste mês, ou não há alunos ativos com plano.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Aluno</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Plano</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {(eligibleStudents ?? []).map((student) => {
                    const plan = Array.isArray(student.plans) ? student.plans[0] : student.plans;
                    return (
                      <tr key={student.id} className="border-b border-border/50">
                        <td className="px-4 py-3 text-sm font-medium">{student.full_name}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {plan
                            ? `${plan.name} — ${formatCurrency(Number(plan.monthly_price))}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1"
                            disabled={!!busyAction}
                            onClick={() => void handleGenerateIndividual(student.id)}
                          >
                            {busyAction === `student:${student.id}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Receipt className="h-3 w-3" />
                            )}
                            Gerar cobrança
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      )}

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
                  const canSend = isAdmin && b.status !== "pago" && b.status !== "cancelado";
                  const alreadySent = b.status === "enviado_whatsapp" || !!b.whatsapp_sent_at;

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
                            {canSend && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-xs"
                                disabled={sendingId === b.id || !!busyAction}
                                onClick={() => void handleResendWhatsApp(b.id, alreadySent)}
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
                {formatBillingSettingsLabel(billingSettings)}
              </p>
            )}
          </>
        )}
      </motion.div>

      <AlertDialog open={confirmAction === "generate"} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar cobranças do mês</AlertDialogTitle>
            <AlertDialogDescription>
              Gerar cobranças com vencimento no dia 15 para alunos ativos com plano e CPF/CNPJ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runGenerate(false)}>Gerar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAction === "generate_send"} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar e enviar cobranças</AlertDialogTitle>
            <AlertDialogDescription>
              Gerar cobranças e enviar pelo WhatsApp para alunos ativos?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runGenerate(true)}>Gerar e enviar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAction === "send_pending"} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar WhatsApp para pendentes</AlertDialogTitle>
            <AlertDialogDescription>
              Enviar cobranças abertas do mês atual (com boleto, ainda não pagas) pelo WhatsApp?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runSendPending()}>Enviar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!resendBillingId} onOpenChange={(open) => !open && setResendBillingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reenviar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta cobrança já foi enviada. Deseja reenviar a mensagem ao aluno?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resendBillingId && void sendWhatsApp(resendBillingId, true)}
            >
              Reenviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resumo da operação</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {summaryLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Financeiro;
