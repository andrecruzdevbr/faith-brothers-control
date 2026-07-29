import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  DollarSign, CheckCircle, AlertCircle, Clock, ExternalLink, Receipt, History, Wallet,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StudentPlanEditor } from "@/components/StudentPlanEditor";
import { useMyBillings } from "@/hooks/useQueries";
import { formatCurrency, formatDateBR } from "@/lib/api";
import { BILLING_STATUS_LABELS } from "@/lib/constants";
import {
  formatPendingPlanChangeLabel,
  formatPlanCurrentLabel,
} from "@/lib/plans";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";

function deriveOverallStatus(billings: { status: Enums<"billing_status">; due_date: string }[]) {
  if (billings.length === 0) return "sem_cobranca" as const;
  const latest = billings[0];
  if (latest.status === "vencido") return "atrasado" as const;
  if (latest.status === "pago") return "em_dia" as const;
  const days = Math.ceil((new Date(latest.due_date + "T12:00:00").getTime() - Date.now()) / 86400000);
  if (days >= 0 && days <= 7) return "proximo" as const;
  if (["pendente", "gerado", "enviado_whatsapp"].includes(latest.status)) return "pendente" as const;
  return "em_dia" as const;
}

const statusConfig = {
  em_dia: { label: "Em Dia", icon: CheckCircle, class: "text-success bg-success/10 border-success/30", desc: "Sua situação financeira está em dia." },
  atrasado: { label: "Atrasado", icon: AlertCircle, class: "text-destructive bg-destructive/10 border-destructive/30", desc: "Você possui cobrança(s) vencida(s). Regularize para continuar treinando." },
  proximo: { label: "Vence Breve", icon: Clock, class: "text-warning bg-warning/10 border-warning/30", desc: "Sua próxima cobrança vence em breve." },
  pendente: { label: "Pendente", icon: Clock, class: "text-warning bg-warning/10 border-warning/30", desc: "Aguardando pagamento da cobrança atual." },
  sem_cobranca: { label: "Sem Cobrança", icon: DollarSign, class: "text-muted-foreground bg-secondary border-border", desc: "Nenhuma cobrança registrada ainda." },
};

const billingStatusClass: Record<string, string> = {
  pago: "text-success bg-success/10",
  vencido: "text-destructive bg-destructive/10",
  pendente: "text-warning bg-warning/10",
  gerado: "text-warning bg-warning/10",
  enviado_whatsapp: "text-primary bg-primary/10",
  cancelado: "text-muted-foreground bg-secondary",
  falhou: "text-destructive bg-destructive/10",
};

const MeuFinanceiro = () => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useMyBillings();
  const [requestOpen, setRequestOpen] = useState(false);

  const student = data && !Array.isArray(data) ? data.student : null;
  const billings = data && !Array.isArray(data) ? data.billings : [];

  const { data: academyId } = useQuery({
    queryKey: ["my-student-academy", student?.id],
    enabled: !!student?.id,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("students")
        .select("academy_id")
        .eq("id", student!.id)
        .maybeSingle();
      if (error) throw error;
      return row?.academy_id ?? null;
    },
  });

  const { data: pendingChange } = useQuery({
    queryKey: ["my-pending-plan-change", student?.id],
    enabled: !!student?.id,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("student_plan_change_requests")
        .select("id, requested_plan_id, requested_plan:plans!requested_plan_id(name, monthly_price)")
        .eq("student_id", student!.id)
        .eq("status", "pending")
        .maybeSingle();
      if (error) throw error;
      return rows;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const plan = student?.plans;
  const planInfo = Array.isArray(plan) ? plan[0] : plan;
  const requestedPlan = pendingChange
    ? Array.isArray(pendingChange.requested_plan)
      ? pendingChange.requested_plan[0]
      : pendingChange.requested_plan
    : null;

  const overallKey = deriveOverallStatus(billings);
  const current = statusConfig[overallKey];
  const latestBilling = billings[0];
  const lastPaid = billings.find((b) => b.status === "pago");
  const openBillings = billings.filter((b) => b.status !== "pago" && b.status !== "cancelado");

  if (!student) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">MEU FINANCEIRO</h1>
        <p className="text-sm text-muted-foreground">Perfil de aluno não encontrado. Entre em contato com a academia.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">MEU FINANCEIRO</h1>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-xl border p-6 shadow-card flex items-center gap-4 ${current.class}`}
      >
        <current.icon className="h-10 w-10 shrink-0" />
        <div>
          <p className="font-display text-xl font-bold">{current.label}</p>
          <p className="text-sm opacity-80">{current.desc}</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold tracking-wider">DETALHES DO PLANO</h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={!!pendingChange || !academyId}
            onClick={() => setRequestOpen(true)}
          >
            <Wallet className="h-3.5 w-3.5" />
            Solicitar mudança
          </Button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Plano atual</span>
            <span className="text-foreground font-medium text-right">
              {formatPlanCurrentLabel(
                planInfo
                  ? { name: planInfo.name, monthly_price: planInfo.monthly_price }
                  : null,
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Valor mensal</span>
            <span className="text-foreground font-medium">
              {planInfo?.monthly_price != null
                ? formatCurrency(Number(planInfo.monthly_price))
                : "—"}
            </span>
          </div>
          {pendingChange ? (
            <p className="text-xs text-warning">
              {formatPendingPlanChangeLabel(requestedPlan?.name)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              A mudança de plano precisa da aprovação do administrador. A cobrança segue o plano atual até lá.
            </p>
          )}
          {latestBilling && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Próximo vencimento</span>
                <span className="text-foreground font-medium">{formatDateBR(latestBilling.due_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Referência</span>
                <span className="text-foreground font-medium">{formatDateBR(latestBilling.reference_month)}</span>
              </div>
            </>
          )}
          {lastPaid?.paid_at && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Último pagamento</span>
              <span className="text-foreground font-medium">{formatDateBR(lastPaid.paid_at.slice(0, 10))}</span>
            </div>
          )}
        </div>
      </motion.div>

      {openBillings.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-xl border border-border bg-card p-6 shadow-card"
        >
          <div className="flex items-center gap-2 mb-4">
            <ExternalLink className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold tracking-wider">BOLETOS EM ABERTO</h3>
          </div>
          <div className="space-y-3">
            {openBillings.map((b) => (
              <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">{formatCurrency(Number(b.amount))}</p>
                  <p className="text-xs text-muted-foreground">
                    Vence {formatDateBR(b.due_date)} • {BILLING_STATUS_LABELS[b.status] ?? b.status}
                  </p>
                </div>
                {b.boleto_url ? (
                  <Button asChild size="sm" className="gradient-primary text-primary-foreground">
                    <a href={b.boleto_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" /> Pagar boleto / PIX
                    </a>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Link indisponível — contate a academia</p>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {lastPaid && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-success/30 bg-card p-6 shadow-card"
        >
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="h-5 w-5 text-success" />
            <h3 className="font-display text-lg font-bold tracking-wider">ÚLTIMO RECIBO</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Valor pago</span>
              <span className="text-foreground font-medium">{formatCurrency(Number(lastPaid.amount))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data do pagamento</span>
              <span className="text-foreground font-medium">
                {lastPaid.paid_at ? formatDateBR(lastPaid.paid_at.slice(0, 10)) : "—"}
              </span>
            </div>
            {lastPaid.invoice_number && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nº da fatura</span>
                <span className="text-foreground font-medium">{lastPaid.invoice_number}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Referência</span>
              <span className="text-foreground font-medium">{formatDateBR(lastPaid.reference_month)}</span>
            </div>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
      >
        <div className="p-5 border-b border-border flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">HISTÓRICO</h3>
        </div>
        {billings.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">Nenhuma cobrança no histórico.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Referência</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Valor</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Vencimento</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {billings.map((b) => (
                  <tr key={b.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 text-sm text-foreground">{formatDateBR(b.reference_month)}</td>
                    <td className="px-4 py-3 text-sm font-display font-bold text-foreground">{formatCurrency(Number(b.amount))}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell">{formatDateBR(b.due_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${billingStatusClass[b.status] ?? "text-muted-foreground bg-secondary"}`}>
                        {BILLING_STATUS_LABELS[b.status] ?? b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                      {b.paid_at ? formatDateBR(b.paid_at.slice(0, 10)) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Solicitar mudança de plano</DialogTitle>
          </DialogHeader>
          {academyId && (
            <StudentPlanEditor
              studentId={student.id}
              academyId={academyId}
              currentPlanId={student.plan_id}
              mode="request"
              onSaved={() => {
                void queryClient.invalidateQueries({ queryKey: ["my-pending-plan-change"] });
                void queryClient.invalidateQueries({ queryKey: ["my-billings"] });
                setRequestOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MeuFinanceiro;
