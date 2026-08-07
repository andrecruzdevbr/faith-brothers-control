import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/api";
import {
  PREPAID_PAYMENT_METHOD_LABELS,
  buildCoverageMonths,
  estimatedInstallmentAmount,
  formatCoverageMonthLabel,
  isMachineBillingMode,
  maskTaxId,
  planDisplayTotal,
  resolveInstallments,
  todayIsoDateSaoPaulo,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";
import { useToast } from "@/hooks/use-toast";

export type PrepaidApprovalStudent = {
  id: string;
  full_name: string;
  plan_id: string | null;
  requested_payment_method?: string | null;
  requested_installments?: number | null;
  payment_review_status?: string | null;
  pending_family_group_id?: string | null;
  pending_family_invite_code?: string | null;
  plans?: {
    name?: string | null;
    monthly_price?: number | null;
    package_total_amount?: number | null;
    duration_months?: number | null;
    billing_mode?: string | null;
    allows_installments?: boolean | null;
    max_installments?: number | null;
    training_days_per_week?: number | null;
  } | null;
};

type FamilyGroup = {
  id: string;
  name: string;
  invite_code: string;
  financial_responsible_name: string;
  financial_responsible_tax_id: string | null;
  financial_responsible_phone: string | null;
  financial_responsible_email: string | null;
  financial_responsible_student_id: string | null;
};

type FamilyMemberRow = {
  id: string;
  student_id: string;
  relationship: string;
  status: string;
  students: {
    id: string;
    full_name: string;
    status: string;
    plan_id: string | null;
    plans?: { training_days_per_week?: number | null; name?: string | null } | null;
  } | null;
};

type Props = {
  student: PrepaidApprovalStudent;
  onDone: () => void;
};

export function PrepaidApprovalDialog({ student, onDone }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [family, setFamily] = useState<FamilyGroup | null>(null);
  const [members, setMembers] = useState<FamilyMemberRow[]>([]);
  const [startsOn, setStartsOn] = useState(todayIsoDateSaoPaulo());
  const [paymentMethod, setPaymentMethod] = useState<PrepaidPaymentMethod>(
    (student.requested_payment_method as PrepaidPaymentMethod) || "pix",
  );
  const [installments, setInstallments] = useState(String(student.requested_installments || 1));
  const [totalAmount, setTotalAmount] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const plan = student.plans;
  const isFamily = Boolean(student.pending_family_group_id);
  const duration = Number(plan?.duration_months ?? 0);
  const defaultTotal = planDisplayTotal({
    billing_mode: plan?.billing_mode,
    package_total_amount: plan?.package_total_amount,
    monthly_price: plan?.monthly_price,
  });

  useEffect(() => {
    setTotalAmount(String(defaultTotal || ""));
  }, [defaultTotal]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      if (!student.pending_family_group_id) {
        if (!cancelled) {
          setFamily(null);
          setMembers([]);
          setLoading(false);
        }
        return;
      }

      const { data: group, error: groupError } = await supabase
        .from("family_groups" as never)
        .select(
          "id, name, invite_code, financial_responsible_name, financial_responsible_tax_id, financial_responsible_phone, financial_responsible_email, financial_responsible_student_id",
        )
        .eq("id", student.pending_family_group_id)
        .maybeSingle();

      if (groupError) {
        toast({ title: "Erro ao carregar família", description: groupError.message, variant: "destructive" });
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: memberRows, error: membersError } = await supabase
        .from("family_members" as never)
        .select(
          "id, student_id, relationship, status, students(id, full_name, status, plan_id, plans(name, training_days_per_week))",
        )
        .eq("family_group_id", student.pending_family_group_id);

      if (membersError) {
        toast({ title: "Erro ao carregar integrantes", description: membersError.message, variant: "destructive" });
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) {
        setFamily(group as unknown as FamilyGroup);
        const list = (memberRows ?? []) as unknown as FamilyMemberRow[];
        setMembers(list);
        setSelectedMemberIds(list.map((m) => m.student_id));
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [student.pending_family_group_id, toast]);

  const months = useMemo(() => buildCoverageMonths(startsOn, duration), [startsOn, duration]);

  const installmentPreview = useMemo(() => {
    const total = Number(totalAmount || defaultTotal || 0);
    const resolved = resolveInstallments({
      paymentMethod,
      requestedInstallments: Number(installments || 1),
      allowsInstallments: !!plan?.allows_installments,
      maxInstallments: plan?.max_installments ?? 1,
    });
    return {
      installments: resolved.installments,
      error: resolved.error,
      parcel: estimatedInstallmentAmount(total, resolved.installments),
      total,
    };
  }, [paymentMethod, installments, totalAmount, defaultTotal, plan]);

  const confirmPayment = async () => {
    if (!student.plan_id) {
      toast({ title: "Aluno sem plano", variant: "destructive" });
      return;
    }
    if (!isMachineBillingMode(plan?.billing_mode)) {
      toast({ title: "Plano não é de pagamento antecipado", variant: "destructive" });
      return;
    }
    if (installmentPreview.error) {
      toast({ title: installmentPreview.error, variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const meta = {
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        confirmed_from: "alunos_prepaid_dialog",
        confirmed_at_client: new Date().toISOString(),
      };

      if (isFamily && family) {
        if (selectedMemberIds.length < 1) {
          throw new Error("Selecione ao menos um integrante coberto");
        }
        const { error } = await supabase.rpc("confirm_family_prepaid_payment" as never, {
          _family_group_id: family.id,
          _plan_id: student.plan_id,
          _starts_on: startsOn,
          _payment_method: paymentMethod,
          _installments: installmentPreview.installments,
          _member_student_ids: selectedMemberIds,
          _total_amount: installmentPreview.total,
          _confirmation_meta: meta,
        } as never);
        if (error) throw error;
        toast({
          title: "Família liberada",
          description: "Pagamento confirmado. Meses liberados para os integrantes selecionados.",
        });
      } else {
        const { error } = await supabase.rpc("confirm_individual_prepaid_payment" as never, {
          _student_id: student.id,
          _plan_id: student.plan_id,
          _starts_on: startsOn,
          _payment_method: paymentMethod,
          _installments: installmentPreview.installments,
          _total_amount: installmentPreview.total,
          _confirmation_meta: meta,
        } as never);
        if (error) throw error;
        toast({
          title: "Pagamento aprovado",
          description: "Meses do pacote liberados. Nenhum boleto Asaas será gerado nesses meses.",
        });
      }
      onDone();
    } catch (e) {
      const description =
        e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : e instanceof Error
            ? e.message
            : "Tente novamente.";
      toast({ title: "Não foi possível confirmar", description, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando revisão…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm space-y-1">
        <p>
          <span className="text-muted-foreground">Aluno:</span> {student.full_name}
        </p>
        <p>
          <span className="text-muted-foreground">Plano:</span> {plan?.name ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Frequência:</span>{" "}
          {plan?.training_days_per_week ?? "—"} dias/semana
        </p>
        <p className="text-xs text-muted-foreground">
          Regra V1: o mês da data de início conta inteiro, mesmo começando no meio do mês.
        </p>
      </div>

      {isFamily && family ? (
        <div className="rounded-lg border border-border p-3 text-sm space-y-2">
          <p className="font-medium">Grupo familiar — {family.name}</p>
          <p>Responsável: {family.financial_responsible_name}</p>
          <p>CPF: {maskTaxId(family.financial_responsible_tax_id)}</p>
          <p>Telefone: {family.financial_responsible_phone || "—"}</p>
          <p>E-mail: {family.financial_responsible_email || "—"}</p>
          <p className="text-xs text-muted-foreground">Código: {family.invite_code}</p>
          <div className="space-y-2 pt-2">
            <p className="font-medium">Integrantes</p>
            {members.map((m) => {
              const st = Array.isArray(m.students) ? m.students[0] : m.students;
              const checked = selectedMemberIds.includes(m.student_id);
              return (
                <label key={m.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={(e) => {
                      setSelectedMemberIds((prev) =>
                        e.target.checked
                          ? [...prev, m.student_id]
                          : prev.filter((id) => id !== m.student_id),
                      );
                    }}
                  />
                  <span>
                    {st?.full_name ?? m.student_id} · {m.relationship} ·{" "}
                    {st?.plans?.training_days_per_week ?? plan?.training_days_per_week ?? "—"}x/sem ·{" "}
                    {st?.status}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="startsOn">Data de início</Label>
          <Input id="startsOn" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
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
        <div className="space-y-1.5">
          <Label htmlFor="totalAmount">Valor total</Label>
          <Input
            id="totalAmount"
            inputMode="decimal"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Parcelas</Label>
          <Select
            value={installments}
            onValueChange={setInstallments}
            disabled={paymentMethod !== "cartao_credito"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: plan?.max_installments ?? 1 }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-secondary/20 p-3 text-sm space-y-1">
        <p>
          Total: <strong>{formatCurrency(installmentPreview.total)}</strong>
        </p>
        <p>
          Parcelas (maquininha): {installmentPreview.installments}x de{" "}
          {formatCurrency(installmentPreview.parcel)}
        </p>
        <p className="text-xs text-muted-foreground">
          Meses que serão liberados:{" "}
          {months.length > 0 ? months.map(formatCoverageMonthLabel).join(", ") : "nenhum (avulso)"}
        </p>
      </div>

      <Button
        className="w-full gradient-primary text-primary-foreground"
        disabled={submitting}
        onClick={() => void confirmPayment()}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        {isFamily ? "Pagamento aprovado e família liberada" : "Pagamento aprovado e meses liberados"}
      </Button>
    </div>
  );
}
