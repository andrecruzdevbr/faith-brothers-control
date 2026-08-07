import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Link2, Pencil, Plus, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { callEdgeFunction, formatCurrency } from "@/lib/api";
import { BELTS } from "@/lib/constants";
import { isValidBrazilianWhatsapp, normalizeWhatsapp } from "@/lib/whatsapp-auth";
import { isValidTaxId, normalizeTaxId } from "@/lib/tax-id";
import { formatPlanOptionLabel, type PlanOption } from "@/lib/plans";
import { isMinor, validateStudentBirthFields } from "@/lib/student-age";
import {
  PREPAID_PAYMENT_METHOD_LABELS,
  estimatedInstallmentAmount,
  isMachineBillingMode,
  maskTaxId,
  planDisplayTotal,
  resolveInstallments,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";
import {
  FAMILY_RELATIONSHIPS,
  MAX_BELT_DEGREES,
  buildFamilyWizardMemberPayload,
  countFamilyPractitioners,
  createEmptyMemberDraft,
  formatBeltDegreesLabel,
  validateFamilyWizardMembers,
  validatePractitionerSports,
  type FamilyWizardMemberDraft,
} from "@/lib/family-wizard";
import { supabase } from "@/integrations/supabase/client";

type AcademyOption = {
  id: string;
  name: string;
  slug: string;
  prepaid_contracts_enabled?: boolean;
  family_plans_enabled?: boolean;
};

type SearchHit = {
  id: string;
  full_name: string;
  birth_date: string | null;
  whatsapp_masked: string;
  email_masked: string | null;
  belt: string | null;
  degrees: number | null;
  status: string;
};

type Props = {
  onBackToTypeChoice: () => void;
};

const STEP_LABELS = [
  "Responsável financeiro",
  "Plano familiar",
  "Integrantes",
  "Pagamento",
  "Resumo",
] as const;

export function FamilyRegistrationWizard({ onBackToTypeChoice }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [academies, setAcademies] = useState<AcademyOption[]>([]);
  const [loadingAcademies, setLoadingAcademies] = useState(true);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [billingTaxId, setBillingTaxId] = useState("");
  const [responsibleTrains, setResponsibleTrains] = useState<boolean | null>(null);
  const [belt, setBelt] = useState("Branca");
  const [degrees, setDegrees] = useState(0);
  const [trainingDays, setTrainingDays] = useState(3);
  const [guardianName, setGuardianName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [academyId, setAcademyId] = useState("");
  const [planId, setPlanId] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<PrepaidPaymentMethod | "">("");
  const [installments, setInstallments] = useState("1");

  const [members, setMembers] = useState<FamilyWizardMemberDraft[]>([]);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftMember, setDraftMember] = useState<FamilyWizardMemberDraft>(createEmptyMemberDraft());
  const [linkMode, setLinkMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  const selectedPlan = plans.find((p) => p.id === planId);
  const machinePlan = isMachineBillingMode(selectedPlan?.billing_mode);
  const showGuardian = !!birthDate && isMinor(birthDate);
  const practitionerCount = countFamilyPractitioners(responsibleTrains === true, members.length);
  const totalAmount = selectedPlan ? planDisplayTotal(selectedPlan) : 0;

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.rpc("get_public_academies");
      if (error) {
        toast({ title: "Não foi possível carregar academias", description: error.message, variant: "destructive" });
      } else {
        setAcademies((data ?? []) as AcademyOption[]);
      }
      setLoadingAcademies(false);
    };
    void load();
  }, [toast]);

  useEffect(() => {
    setPlanId("");
    if (!academyId) {
      setPlans([]);
      return;
    }
    let cancelled = false;
    const loadPlans = async () => {
      setLoadingPlans(true);
      const { data, error } = await supabase.rpc("get_public_active_plans", { _academy_id: academyId });
      if (cancelled) return;
      if (error) {
        toast({ title: "Não foi possível carregar planos", description: error.message, variant: "destructive" });
        setPlans([]);
      } else {
        setPlans(
          (data ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            monthly_price: Number(p.monthly_price),
            training_days_per_week: p.training_days_per_week,
            audience: (p as PlanOption).audience,
            plan_kind: (p as PlanOption).plan_kind,
            duration_months: (p as PlanOption).duration_months ?? 1,
            reference_monthly_price: (p as PlanOption).reference_monthly_price,
            package_total_amount: (p as PlanOption).package_total_amount,
            billing_mode: (p as PlanOption).billing_mode ?? "asaas_monthly",
            allows_installments: (p as PlanOption).allows_installments ?? false,
            max_installments: (p as PlanOption).max_installments ?? 1,
            description: (p as PlanOption).description,
          })),
        );
      }
      setLoadingPlans(false);
    };
    void loadPlans();
    return () => {
      cancelled = true;
    };
  }, [academyId, toast]);

  useEffect(() => {
    if (selectedPlan?.training_days_per_week && responsibleTrains) {
      setTrainingDays(selectedPlan.training_days_per_week);
    }
  }, [selectedPlan?.id, selectedPlan?.training_days_per_week, responsibleTrains]);

  const installmentPreview = useMemo(() => {
    if (!machinePlan || !selectedPlan || !paymentMethod) return null;
    const resolved = resolveInstallments({
      paymentMethod,
      requestedInstallments: Number(installments || 1),
      allowsInstallments: !!selectedPlan.allows_installments,
      maxInstallments: selectedPlan.max_installments ?? 1,
    });
    return {
      installments: resolved.installments,
      error: resolved.error,
      parcel: estimatedInstallmentAmount(totalAmount, resolved.installments),
    };
  }, [machinePlan, selectedPlan, paymentMethod, installments, totalAmount]);

  const validateStepResponsible = (): string | null => {
    if (fullName.trim().length < 3) return "Informe o nome completo do responsável financeiro.";
    if (!isValidBrazilianWhatsapp(whatsapp)) return "WhatsApp do responsável inválido (11 dígitos).";
    if (!birthDate) return "Informe a data de nascimento.";
    const birthError = validateStudentBirthFields({ birthDate, guardianName });
    if (birthError) return birthError;
    if (!email.trim() || !email.includes("@")) return "Informe um e-mail válido.";
    if (!isValidTaxId(billingTaxId)) return "CPF/CNPJ de cobrança inválido.";
    if (responsibleTrains === null) return "Informe se o responsável financeiro também vai treinar.";
    if (responsibleTrains) {
      const sports = validatePractitionerSports({ belt, degrees, trainingDays, label: "responsável" });
      if (sports) return sports;
    }
    if (password.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
    if (password !== confirmPassword) return "As senhas não conferem.";
    return null;
  };

  const validateStepPlan = (): string | null => {
    if (!academyId) return "Selecione a academia.";
    if (!planId) return "Selecione o plano familiar.";
    return null;
  };

  const validateStepPayment = (): string | null => {
    if (machinePlan && !paymentMethod) return "Selecione a forma de pagamento.";
    if (installmentPreview?.error) return installmentPreview.error;
    return null;
  };

  const openNewMember = () => {
    setLinkMode(false);
    setEditingKey(null);
    setDraftMember(createEmptyMemberDraft(selectedPlan?.training_days_per_week ?? 3));
    setMemberFormOpen(true);
    setSearchHits([]);
    setSearchQuery("");
  };

  const openLinkMember = () => {
    setLinkMode(true);
    setEditingKey(null);
    setDraftMember({ ...createEmptyMemberDraft(selectedPlan?.training_days_per_week ?? 3), mode: "link" });
    setMemberFormOpen(true);
    setSearchHits([]);
    setSearchQuery("");
  };

  const openEditMember = (member: FamilyWizardMemberDraft) => {
    setLinkMode(member.mode === "link");
    setEditingKey(member.key);
    setDraftMember({ ...member });
    setMemberFormOpen(true);
    setSearchHits([]);
    setSearchQuery("");
  };

  const saveMemberDraft = () => {
    if (linkMode) {
      if (!draftMember.existingStudentId) {
        toast({ title: "Selecione um aluno na busca", variant: "destructive" });
        return;
      }
      const sports = validatePractitionerSports({
        belt: draftMember.belt || "Branca",
        degrees: draftMember.degrees,
        trainingDays: draftMember.trainingDays,
      });
      if (sports) {
        toast({ title: sports, variant: "destructive" });
        return;
      }
    } else {
      const check = validateFamilyWizardMembers([{ ...draftMember, mode: "new" }], {
        responsibleTrains: true,
      });
      if (!check.ok) {
        toast({ title: check.error, variant: "destructive" });
        return;
      }
    }

    const saved: FamilyWizardMemberDraft = {
      ...draftMember,
      mode: linkMode ? "link" : "new",
    };

    setMembers((prev) => {
      if (editingKey) {
        return prev.map((m) => (m.key === editingKey ? saved : m));
      }
      return [...prev, saved];
    });
    setJustAddedKey(saved.key);
    setMemberFormOpen(false);
    setEditingKey(null);
  };

  const runSearch = async () => {
    if (!academyId) {
      toast({ title: "Selecione a academia na etapa do plano", variant: "destructive" });
      return;
    }
    setSearching(true);
    try {
      const data = await callEdgeFunction<{ students: SearchHit[] }>(
        "register-student",
        { action: "search_students", academy_id: academyId, query: searchQuery },
        { requireAuth: false },
      );
      setSearchHits(data.students ?? []);
    } catch (err) {
      toast({
        title: "Busca falhou",
        description: err instanceof Error ? err.message : "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    const err1 = validateStepResponsible();
    if (err1) {
      toast({ title: err1, variant: "destructive" });
      setStep(0);
      return;
    }
    const err2 = validateStepPlan();
    if (err2) {
      toast({ title: err2, variant: "destructive" });
      setStep(1);
      return;
    }
    const membersCheck = validateFamilyWizardMembers(members, { responsibleTrains });
    if (!membersCheck.ok) {
      toast({ title: membersCheck.error, variant: "destructive" });
      setStep(2);
      return;
    }
    const err4 = validateStepPayment();
    if (err4) {
      toast({ title: err4, variant: "destructive" });
      setStep(3);
      return;
    }

    let resolvedInstallments = 1;
    if (machinePlan && paymentMethod && selectedPlan) {
      const resolved = resolveInstallments({
        paymentMethod,
        requestedInstallments: Number(installments || 1),
        allowsInstallments: !!selectedPlan.allows_installments,
        maxInstallments: selectedPlan.max_installments ?? 1,
      });
      if (resolved.error) {
        toast({ title: resolved.error, variant: "destructive" });
        return;
      }
      resolvedInstallments = resolved.installments;
    }

    setSubmitting(true);
    try {
      await callEdgeFunction(
        "register-student",
        {
          contract_type: "familiar",
          family_mode: "wizard",
          full_name: fullName.trim(),
          whatsapp: normalizeWhatsapp(whatsapp),
          password,
          academy_id: academyId,
          plan_id: planId,
          birth_date: birthDate,
          guardian_name: guardianName.trim() || null,
          billing_tax_id: normalizeTaxId(billingTaxId),
          payment_method: machinePlan ? paymentMethod : null,
          installments: machinePlan ? resolvedInstallments : null,
          financial_responsible_email: email.trim(),
          financial_responsible_name: fullName.trim(),
          financial_responsible_phone: normalizeWhatsapp(whatsapp),
          family_name: familyName.trim() || `Família ${fullName.trim()}`,
          responsible_trains: responsibleTrains === true,
          belt: responsibleTrains ? belt : null,
          degrees: responsibleTrains ? degrees : null,
          responsible_weekly_frequency: responsibleTrains ? trainingDays : null,
          members: buildFamilyWizardMemberPayload(members),
        },
        { requireAuth: false },
      );
      toast({
        title: "Cadastro familiar enviado",
        description: "Aguarde a academia confirmar o pagamento. Nenhum boleto é gerado agora.",
      });
      navigate("/login", { replace: true });
    } catch (err) {
      toast({
        title: "Não foi possível enviar o cadastro",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const goNext = () => {
    if (step === 0) {
      const err = validateStepResponsible();
      if (err) {
        toast({ title: err, variant: "destructive" });
        return;
      }
    }
    if (step === 1) {
      const err = validateStepPlan();
      if (err) {
        toast({ title: err, variant: "destructive" });
        return;
      }
    }
    if (step === 2) {
      const check = validateFamilyWizardMembers(members, { responsibleTrains });
      if (!check.ok) {
        toast({ title: check.error, variant: "destructive" });
        return;
      }
      if (memberFormOpen) {
        toast({ title: "Salve ou cancele o formulário do integrante antes de continuar.", variant: "destructive" });
        return;
      }
    }
    if (step === 3) {
      const err = validateStepPayment();
      if (err) {
        toast({ title: err, variant: "destructive" });
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  };

  const sportsFields = (
    prefix: string,
    values: { belt: string; degrees: number; trainingDays: number },
    onChange: (patch: Partial<{ belt: string; degrees: number; trainingDays: number }>) => void,
  ) => (
    <>
      <div className="space-y-1.5">
        <Label>Faixa atual</Label>
        <Select value={values.belt} onValueChange={(v) => onChange({ belt: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione a faixa" />
          </SelectTrigger>
          <SelectContent>
            {BELTS.map((b) => (
              <SelectItem key={`${prefix}-${b}`} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Quantidade de graus na faixa</Label>
        <Select
          value={String(values.degrees)}
          onValueChange={(v) => onChange({ degrees: Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: MAX_BELT_DEGREES + 1 }, (_, i) => i).map((n) => (
              <SelectItem key={`${prefix}-deg-${n}`} value={String(n)}>
                {n} {n === 1 ? "grau" : "graus"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Frequência semanal</Label>
        <Select
          value={String(values.trainingDays)}
          onValueChange={(v) => onChange({ trainingDays: Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <SelectItem key={`${prefix}-freq-${n}`} value={String(n)}>
                {n}x / semana
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Etapa {step + 1} de {STEP_LABELS.length}
        </p>
        <p className="text-xs text-muted-foreground">{STEP_LABELS[step]}</p>
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${((step + 1) / STEP_LABELS.length) * 100}%` }}
          />
        </div>
      </div>

      {step === 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            O WhatsApp informado será o único número obrigatório da família (confirmação, contrato,
            cobranças e comunicações). O CPF/CNPJ de cobrança pertence somente ao responsável.
          </p>
          <div className="space-y-1.5">
            <Label>Nome completo</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="space-y-1.5">
            <Label>WhatsApp</Label>
            <Input
              inputMode="numeric"
              maxLength={11}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder="31999999999"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Data de nascimento</Label>
            <Input
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>
          {showGuardian ? (
            <div className="space-y-1.5">
              <Label>Nome do responsável legal *</Label>
              <Input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" />
          </div>
          <div className="space-y-1.5">
            <Label>CPF ou CNPJ de cobrança</Label>
            <Input
              inputMode="numeric"
              value={billingTaxId}
              onChange={(e) => setBillingTaxId(e.target.value.replace(/\D/g, "").slice(0, 14))}
              placeholder="Somente números"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Nome do grupo familiar (opcional)</Label>
            <Input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="Ex.: Família Silva"
            />
          </div>
          <div className="space-y-2 rounded-xl border border-border p-3">
            <Label>O responsável financeiro também vai treinar?</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={responsibleTrains === true ? "default" : "outline"}
                className="flex-1"
                onClick={() => setResponsibleTrains(true)}
              >
                Sim
              </Button>
              <Button
                type="button"
                variant={responsibleTrains === false ? "default" : "outline"}
                className="flex-1"
                onClick={() => setResponsibleTrains(false)}
              >
                Não
              </Button>
            </div>
          </div>
          {responsibleTrains ? (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <p className="text-sm font-medium">Dados esportivos do responsável</p>
              {sportsFields("resp", { belt, degrees, trainingDays }, (patch) => {
                if (patch.belt != null) setBelt(patch.belt);
                if (patch.degrees != null) setDegrees(patch.degrees);
                if (patch.trainingDays != null) setTrainingDays(patch.trainingDays);
              })}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Senha de acesso</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirmar senha</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Academia</Label>
            <Select value={academyId || undefined} onValueChange={setAcademyId} disabled={loadingAcademies}>
              <SelectTrigger>
                <SelectValue placeholder={loadingAcademies ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                {academies.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Plano familiar</Label>
            <Select value={planId || undefined} onValueChange={setPlanId} disabled={!academyId || loadingPlans}>
              <SelectTrigger>
                <SelectValue placeholder={loadingPlans ? "Carregando..." : "Selecione o plano"} />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {formatPlanOptionLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedPlan ? (
            <p className="text-sm text-muted-foreground">
              Valor do contrato: {formatCurrency(totalAmount)}
              {selectedPlan.duration_months
                ? ` · ${selectedPlan.duration_months} ${selectedPlan.duration_months === 1 ? "mês" : "meses"}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Responsável financeiro</p>
            <p className="font-medium flex items-center gap-2">
              <Check className="h-4 w-4 text-success" /> {fullName || "—"}
            </p>
            <p className="text-sm text-muted-foreground">
              {responsibleTrains
                ? `Treina · ${formatBeltDegreesLabel(belt, degrees)} · ${trainingDays}x/sem`
                : "Não treina (apenas responsável financeiro)"}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Integrantes</p>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum integrante adicionado ainda.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.key}
                    className={`rounded-lg border p-3 text-sm space-y-2 ${
                      justAddedKey === m.key ? "border-success bg-success/5" : "border-border"
                    }`}
                  >
                    {justAddedKey === m.key ? (
                      <p className="text-xs text-success font-medium">Integrante adicionado</p>
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {m.fullName || "Aluno vinculado"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {m.birthDate ? `Nasc. ${m.birthDate} · ` : ""}
                          {formatBeltDegreesLabel(m.belt || "Branca", m.degrees)} · {m.trainingDays}x/sem
                          {m.relationship ? ` · ${m.relationship}` : ""}
                          {m.mode === "link" ? " · vinculado" : ""}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button type="button" size="icon" variant="ghost" onClick={() => openEditMember(m)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => setMembers((prev) => prev.filter((x) => x.key !== m.key))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!memberFormOpen ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" className="flex-1" onClick={openNewMember}>
                <Plus className="h-4 w-4 mr-1" />{" "}
                {members.length ? "Adicionar outro integrante" : "Adicionar integrante"}
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={openLinkMember}>
                <Link2 className="h-4 w-4 mr-1" /> Vincular aluno já existente
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-medium">
                {linkMode ? "Vincular aluno já existente" : editingKey ? "Editar integrante" : "Novo integrante"}
              </p>
              {linkMode ? (
                <>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nome, data de nascimento ou ID"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <Button type="button" onClick={() => void runSearch()} disabled={searching}>
                      Buscar
                    </Button>
                  </div>
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {searchHits.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          className={`w-full text-left rounded-md border px-3 py-2 text-sm ${
                            draftMember.existingStudentId === hit.id
                              ? "border-primary bg-primary/5"
                              : "border-border"
                          }`}
                          onClick={() =>
                            setDraftMember((d) => ({
                              ...d,
                              mode: "link",
                              existingStudentId: hit.id,
                              fullName: hit.full_name,
                              birthDate: hit.birth_date ?? "",
                              belt: hit.belt || d.belt || "Branca",
                              degrees: hit.degrees ?? d.degrees ?? 0,
                            }))
                          }
                        >
                          {hit.full_name}
                          {hit.birth_date ? ` · nasc. ${hit.birth_date}` : ""}
                          {hit.belt ? ` · ${hit.belt}` : ""}
                          {typeof hit.degrees === "number" ? ` · ${hit.degrees}º` : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {draftMember.existingStudentId ? (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Faixa e graus atuais serão preservados (
                        {formatBeltDegreesLabel(draftMember.belt || "Branca", draftMember.degrees)}
                        ). Informe apenas frequência neste contrato e parentesco.
                      </p>
                      <div className="space-y-1.5">
                        <Label>Frequência semanal</Label>
                        <Select
                          value={String(draftMember.trainingDays)}
                          onValueChange={(v) =>
                            setDraftMember((d) => ({ ...d, trainingDays: Number(v) }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                              <SelectItem key={`link-freq-${n}`} value={String(n)}>
                                {n}x / semana
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Parentesco</Label>
                        <Select
                          value={draftMember.relationship}
                          onValueChange={(v) => setDraftMember((d) => ({ ...d, relationship: v }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FAMILY_RELATIONSHIPS.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Nome completo</Label>
                    <Input
                      value={draftMember.fullName}
                      onChange={(e) => setDraftMember((d) => ({ ...d, fullName: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Data de nascimento</Label>
                    <Input
                      type="date"
                      value={draftMember.birthDate}
                      onChange={(e) => setDraftMember((d) => ({ ...d, birthDate: e.target.value }))}
                    />
                  </div>
                  {draftMember.birthDate && isMinor(draftMember.birthDate) ? (
                    <div className="space-y-1.5">
                      <Label>Nome do responsável legal *</Label>
                      <Input
                        value={draftMember.guardianName}
                        onChange={(e) => setDraftMember((d) => ({ ...d, guardianName: e.target.value }))}
                      />
                    </div>
                  ) : null}
                  {sportsFields("new", draftMember, (patch) =>
                    setDraftMember((d) => ({ ...d, ...patch })),
                  )}
                  <div className="space-y-1.5">
                    <Label>Parentesco</Label>
                    <Select
                      value={draftMember.relationship}
                      onValueChange={(v) => setDraftMember((d) => ({ ...d, relationship: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FAMILY_RELATIONSHIPS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Observações (opcional)</Label>
                    <Textarea
                      value={draftMember.notes}
                      onChange={(e) => setDraftMember((d) => ({ ...d, notes: e.target.value }))}
                      rows={2}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    WhatsApp, e-mail, CPF/CNPJ e pagamento ficam apenas com o responsável financeiro.
                  </p>
                </>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    setMemberFormOpen(false);
                    setEditingKey(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="button" className="flex-1" onClick={saveMemberDraft}>
                  {editingKey ? "Salvar alterações" : "Salvar integrante"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Apenas o responsável financeiro informa os dados de pagamento. No cartão de crédito, as
            parcelas são apenas metadados da maquininha.
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">CPF/CNPJ cobrança:</span> {maskTaxId(billingTaxId)}
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">WhatsApp:</span> {whatsapp}
          </p>
          {machinePlan ? (
            <>
              <div className="space-y-1.5">
                <Label>Forma de pagamento</Label>
                <Select
                  value={paymentMethod || undefined}
                  onValueChange={(v) => setPaymentMethod(v as PrepaidPaymentMethod)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
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
              {paymentMethod === "cartao_credito" && selectedPlan?.allows_installments ? (
                <div className="space-y-1.5">
                  <Label>Quantidade de parcelas</Label>
                  <Select value={installments} onValueChange={setInstallments}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: selectedPlan.max_installments ?? 1 }, (_, i) => i + 1).map(
                        (n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}x
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {installmentPreview && paymentMethod ? (
                <p className="text-sm text-muted-foreground">
                  Total {formatCurrency(totalAmount)}
                  {paymentMethod === "cartao_credito"
                    ? ` · ${installmentPreview.installments}x de ${formatCurrency(installmentPreview.parcel)}`
                    : ""}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este plano não exige forma de pagamento antecipada nesta etapa.
            </p>
          )}
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-base">Resumo do cadastro familiar</p>
          <p>
            <span className="text-muted-foreground">Família:</span>{" "}
            {familyName.trim() || `Família ${fullName}`}
          </p>
          <p>
            <span className="text-muted-foreground">Responsável financeiro:</span> {fullName}
          </p>
          <p>
            <span className="text-muted-foreground">CPF/CNPJ cobrança:</span> {maskTaxId(billingTaxId)}
          </p>
          <p>
            <span className="text-muted-foreground">WhatsApp:</span> {whatsapp}
          </p>
          <p>
            <span className="text-muted-foreground">Plano:</span>{" "}
            {selectedPlan ? formatPlanOptionLabel(selectedPlan) : "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Forma de pagamento:</span>{" "}
            {paymentMethod
              ? PREPAID_PAYMENT_METHOD_LABELS[paymentMethod as PrepaidPaymentMethod]
              : "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Parcelas:</span>{" "}
            {paymentMethod === "cartao_credito" ? installments : "1"}
          </p>
          <div>
            <p className="text-muted-foreground mb-1">
              Praticantes ({practitionerCount}) — cada um será um aluno individual
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {responsibleTrains ? (
                <li>
                  {fullName} (responsável) — {trainingDays} dias, faixa {belt.toLowerCase()}, {degrees}{" "}
                  {degrees === 1 ? "grau" : "graus"}
                </li>
              ) : (
                <li className="list-none -ml-5 text-muted-foreground">
                  Responsável não treina (não conta como aluno ativo)
                </li>
              )}
              {members.map((m) => (
                <li key={m.key}>
                  {m.fullName || "Aluno vinculado"} — {m.trainingDays} dias, faixa{" "}
                  {(m.belt || "Branca").toLowerCase()}, {m.degrees}{" "}
                  {m.degrees === 1 ? "grau" : "graus"}
                  {m.relationship ? ` · ${m.relationship}` : ""}
                </li>
              ))}
            </ul>
          </div>
          <p>
            <span className="text-muted-foreground">Valor total do contrato:</span>{" "}
            {formatCurrency(totalAmount)}
          </p>
          <p className="text-xs text-muted-foreground">
            O valor não é multiplicado pela quantidade de integrantes.
          </p>
        </div>
      ) : null}

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => {
            if (step === 0) onBackToTypeChoice();
            else setStep((s) => s - 1);
          }}
        >
          Voltar
        </Button>
        {step < STEP_LABELS.length - 1 ? (
          <Button type="button" className="flex-1" onClick={goNext}>
            Continuar
          </Button>
        ) : (
          <Button
            type="button"
            className="flex-1 gradient-primary text-primary-foreground"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? "Enviando..." : "Finalizar cadastro"}
          </Button>
        )}
      </div>
    </div>
  );
}
