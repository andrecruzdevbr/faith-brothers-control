import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Search, Plus, ChevronLeft, ChevronRight, Check, Loader2, Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StudentBillingTaxIdEditor } from "@/components/StudentBillingTaxIdEditor";
import { supabase } from "@/integrations/supabase/client";
import { useAcademyId, useStudents } from "@/hooks/useQueries";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatWhatsapp } from "@/lib/whatsapp-auth";
import { BILLING_STATUS_LABELS, PAGE_SIZE, STUDENT_STATUS_LABELS } from "@/lib/constants";
import type { Enums } from "@/integrations/supabase/types";

const beltColors: Record<string, string> = {
  Branca: "bg-foreground",
  Cinza: "bg-gray-400",
  Amarela: "bg-yellow-400",
  Laranja: "bg-orange-500",
  Verde: "bg-green-600",
  Azul: "bg-blue-600",
  Roxa: "bg-purple-600",
  Marrom: "bg-amber-800",
  Preta: "bg-foreground",
};

function getFinancialBadge(status: Enums<"billing_status"> | null | undefined, dueDate: string | null | undefined) {
  if (!status) return { label: "Sem cobrança", class: "text-muted-foreground bg-secondary" };
  if (status === "vencido") return { label: "Atrasado", class: "text-destructive bg-destructive/10" };
  if (status === "pago") return { label: "Em dia", class: "text-success bg-success/10" };
  if (dueDate) {
    const days = Math.ceil((new Date(dueDate + "T12:00:00").getTime() - Date.now()) / 86400000);
    if (days >= 0 && days <= 7) return { label: "Vence breve", class: "text-warning bg-warning/10" };
  }
  if (["pendente", "gerado", "enviado_whatsapp"].includes(status)) {
    return { label: BILLING_STATUS_LABELS[status] ?? status, class: "text-warning bg-warning/10" };
  }
  return { label: BILLING_STATUS_LABELS[status] ?? status, class: "text-muted-foreground bg-secondary" };
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

const Alunos = () => {
  const { isAdmin, isStaff } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: academyId } = useAcademyId();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [taxStudent, setTaxStudent] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isFetching } = useStudents(page, search);
  const students = data?.students ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: financialMap } = useQuery({
    queryKey: ["student-financial-map", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("student_financial_overview")
        .select("student_id, status, due_date, plan_name")
        .eq("academy_id", academyId!);
      if (error) throw error;
      return new Map((rows ?? []).map((r) => [r.student_id!, r]));
    },
  });

  const handleApprove = async (studentId: string, approve: boolean) => {
    setApprovingId(studentId);
    try {
      const { error } = await supabase.rpc("approve_student", {
        _student_id: studentId,
        _approve: approve,
      });
      if (error) throw error;
      toast({
        title: approve ? "Aluno aprovado" : "Aluno rejeitado",
        description: approve ? "O aluno agora está ativo na academia." : "O cadastro foi rejeitado.",
      });
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    } catch (e) {
      const description =
        e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : e instanceof Error
            ? e.message
            : "Tente novamente.";
      toast({
        title: "Erro ao processar",
        description,
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">ALUNOS</h1>
          {isLoading ? (
            <Skeleton className="h-4 w-40 mt-1" />
          ) : (
            <p className="text-sm text-muted-foreground mt-1">{total} alunos cadastrados</p>
          )}
        </div>
        <Button className="gradient-primary text-primary-foreground font-medium gap-2" disabled>
          <Plus className="h-4 w-4" /> Novo Aluno
        </Button>
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-10 bg-card border-border"
        />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
      >
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : students.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nenhum aluno encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Aluno</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Faixa</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">Telefone</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Plano</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Financeiro</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  {isStaff && (
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Ações</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {students.map((aluno) => {
                  const plan = Array.isArray(aluno.plans) ? aluno.plans[0] : aluno.plans;
                  const fin = financialMap?.get(aluno.id);
                  const badge = getFinancialBadge(fin?.status ?? null, fin?.due_date ?? null);
                  const isPending = aluno.status === "pendente_aprovacao";

                  return (
                    <tr key={aluno.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground">
                            {getInitials(aluno.full_name)}
                          </div>
                          <span className="text-sm font-medium text-foreground">{aluno.full_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${beltColors[aluno.belt ?? "Branca"] ?? "bg-foreground"}`} />
                          <span className="text-sm text-foreground">{aluno.belt ?? "Branca"}</span>
                          {aluno.degrees > 0 && <span className="text-xs text-muted-foreground">{aluno.degrees}º</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">{formatWhatsapp(aluno.whatsapp)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">
                        {plan?.name ?? fin?.plan_name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge.class}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                          aluno.status === "ativo"
                            ? "text-success bg-success/10"
                            : aluno.status === "pendente_aprovacao"
                              ? "text-warning bg-warning/10"
                              : "text-destructive bg-destructive/10"
                        }`}>
                          {STUDENT_STATUS_LABELS[aluno.status] ?? aluno.status}
                        </span>
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1"
                              onClick={() => setTaxStudent({ id: aluno.id, name: aluno.full_name })}
                            >
                              <Shield className="h-3 w-3" />
                              CPF/CNPJ
                            </Button>
                            {isAdmin && isPending ? (
                              <>
                                <Button
                                  size="sm"
                                  className="gradient-primary text-primary-foreground h-8 gap-1"
                                  disabled={approvingId === aluno.id}
                                  onClick={() => void handleApprove(aluno.id, true)}
                                >
                                  {approvingId === aluno.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  Aprovar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  disabled={approvingId === aluno.id}
                                  onClick={() => void handleApprove(aluno.id, false)}
                                >
                                  Rejeitar
                                </Button>
                              </>
                            ) : !isPending ? (
                              <span className="text-xs text-muted-foreground self-center">—</span>
                            ) : null}
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

        {!isLoading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Página {page} de {totalPages} • {total} registros
              {isFetching && !isLoading && " • Atualizando..."}
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

      <Dialog open={!!taxStudent} onOpenChange={(open) => !open && setTaxStudent(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>CPF/CNPJ de cobrança — {taxStudent?.name}</DialogTitle>
          </DialogHeader>
          {taxStudent && <StudentBillingTaxIdEditor studentId={taxStudent.id} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Alunos;
