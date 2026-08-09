import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { callEdgeFunction, formatCurrency } from "@/lib/api";
import { getHomePath } from "@/lib/access";
import { isValidBrazilianWhatsapp, normalizeWhatsapp } from "@/lib/whatsapp-auth";
import { isValidTaxId, normalizeTaxId } from "@/lib/tax-id";
import { formatPlanOptionLabel, type PlanOption } from "@/lib/plans";
import { isMinor, validateStudentBirthFields } from "@/lib/student-age";
import {
  buildCoverageMonths,
  estimatedInstallmentAmount,
  formatCoverageMonthLabel,
  isMachineBillingMode,
  planDisplayTotal,
  resolveInstallments,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";
import {
  NEW_STUDENT_PAYMENT_LABELS,
  VETERAN_DAY_OPTIONS,
  filterPlansForRegistrationAudience,
  requiresAdminPaymentConfirmation,
  type RegistrationAudience,
} from "@/lib/registration-flows";
import { FamilyRegistrationWizard } from "@/components/family/FamilyRegistrationWizard";
import { ClassScheduleBoard } from "@/components/ClassScheduleBoard";
import { usePublicClassSchedules } from "@/hooks/useQueries";
import type { ClassScheduleRow } from "@/lib/class-schedules";

const BELTS = [
  "Branca",
  "Cinza",
  "Amarela",
  "Laranja",
  "Verde",
  "Azul",
  "Roxa",
  "Marrom",
  "Preta",
];

const signupSchema = z
  .object({
    fullName: z.string().trim().min(3, "Informe seu nome completo").max(120),
    whatsapp: z
      .string()
      .trim()
      .regex(/^\d+$/, "Apenas números são permitidos")
      .refine((value) => isValidBrazilianWhatsapp(value), {
        message: "Informe um WhatsApp com 11 dígitos (DDD + número)",
      }),
    birthDate: z.string().min(1, "Informe a data de nascimento."),
    guardianName: z.string().trim().max(120).optional().or(z.literal("")),
    academyId: z.string().uuid("Selecione uma academia"),
    planId: z.string().uuid("Selecione o plano desejado").optional().or(z.literal("")),
    billingTaxId: z.string().trim().optional().or(z.literal("")),
    belt: z.string().optional(),
    password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(100),
    confirmPassword: z.string().min(8).max(100),
    contractType: z.enum(["individual", "familiar"]),
    registrationAudience: z.enum(["new_student", "veterano"]).optional(),
    trainingDays: z.enum(["2", "3", "5"]).optional(),
    familyMode: z.enum(["create", "join"]).optional(),
    familyName: z.string().trim().max(120).optional().or(z.literal("")),
    familyInviteCode: z.string().trim().max(20).optional().or(z.literal("")),
    familyRelationship: z.string().trim().max(40).optional().or(z.literal("")),
    estimatedMemberCount: z.string().optional().or(z.literal("")),
    financialResponsibleName: z.string().trim().max(120).optional().or(z.literal("")),
    paymentMethod: z
      .enum(["boleto", "cartao_credito", "cartao_debito", "pix", "dinheiro"])
      .optional(),
    installments: z.string().optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    const birthError = validateStudentBirthFields({
      birthDate: data.birthDate,
      guardianName: data.guardianName,
    });
    if (birthError) {
      if (birthError.includes("responsável")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: birthError, path: ["guardianName"] });
      } else {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: birthError, path: ["birthDate"] });
      }
    }
    if (data.contractType === "individual" && !data.registrationAudience) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione se você é novo aluno ou veterano",
        path: ["registrationAudience"],
      });
    }
    if (data.registrationAudience === "new_student" && !data.planId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione o plano desejado",
        path: ["planId"],
      });
    }
    if (data.registrationAudience === "new_student" && !data.paymentMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione a forma de pagamento",
        path: ["paymentMethod"],
      });
    }
    if (data.registrationAudience === "veterano" && !data.trainingDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Escolha 2, 3 ou 5 dias",
        path: ["trainingDays"],
      });
    }
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem",
  });

type SignupValues = z.infer<typeof signupSchema>;
type AcademyOption = {
  id: string;
  name: string;
  slug: string;
  prepaid_contracts_enabled?: boolean;
  family_plans_enabled?: boolean;
};

const Cadastro = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAuthenticated, loading, roles } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [academies, setAcademies] = useState<AcademyOption[]>([]);
  const [loadingAcademies, setLoadingAcademies] = useState(true);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      whatsapp: "",
      birthDate: "",
      guardianName: "",
      academyId: "",
      planId: "",
      billingTaxId: "",
      belt: "Branca",
      password: "",
      confirmPassword: "",
      contractType: "individual",
      registrationAudience: undefined,
      trainingDays: undefined,
      familyMode: "create",
      familyName: "",
      familyInviteCode: "",
      familyRelationship: "responsável",
      estimatedMemberCount: "3",
      financialResponsibleName: "",
      paymentMethod: undefined,
      installments: "1",
    },
  });

  const selectedAcademyId = form.watch("academyId");
  const selectedPlanId = form.watch("planId");
  const birthDateWatch = form.watch("birthDate");
  const contractType = form.watch("contractType");
  const registrationAudience = form.watch("registrationAudience") as RegistrationAudience | undefined;
  const paymentMethod = form.watch("paymentMethod");
  const installmentsWatch = form.watch("installments");
  const showGuardianRequired = !!birthDateWatch && isMinor(birthDateWatch);

  /** Show Individual|Familiar as soon as any public academy has the flag (do not wait for academy select). */
  const familyPlansAvailable = academies.some((a) => !!a.family_plans_enabled);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const machinePlan = isMachineBillingMode(selectedPlan?.billing_mode);
  const isNewStudent = registrationAudience === "new_student";
  const isVeteran = registrationAudience === "veterano";
  const showPaymentFields = isNewStudent || machinePlan;
  const needsCardConfirm = requiresAdminPaymentConfirmation(paymentMethod);
  const requireTaxId = true;

  useEffect(() => {
    const loadAcademies = async () => {
      const { data, error } = await supabase.rpc("get_public_academies");
      if (error) {
        toast({ title: "Não foi possível carregar as academias", description: error.message, variant: "destructive" });
      } else {
        setAcademies((data ?? []) as AcademyOption[]);
      }
      setLoadingAcademies(false);
    };
    void loadAcademies();
  }, [toast]);

  useEffect(() => {
    form.setValue("planId", "");
    if (!selectedAcademyId || !isNewStudent) {
      setPlans([]);
      setLoadingPlans(false);
      return;
    }

    let cancelled = false;
    const loadPlans = async () => {
      setLoadingPlans(true);
      const { data, error } = await supabase.rpc("get_public_active_plans", {
        _academy_id: selectedAcademyId,
        _audience: "new_student",
      });
      if (cancelled) return;
      if (error) {
        // Fallback while migration with _audience is not applied yet
        const fallback = await supabase.rpc("get_public_active_plans", {
          _academy_id: selectedAcademyId,
        });
        if (fallback.error) {
          toast({
            title: "Não foi possível carregar os planos",
            description: fallback.error.message,
            variant: "destructive",
          });
          setPlans([]);
        } else {
          const mapped = (fallback.data ?? []).map((p) => ({
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
          }));
          setPlans(filterPlansForRegistrationAudience(mapped, "new_student"));
        }
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
  }, [selectedAcademyId, isNewStudent, form, toast]);

  useEffect(() => {
    if (!loadingAcademies && !familyPlansAvailable && contractType === "familiar") {
      form.setValue("contractType", "individual");
    }
  }, [loadingAcademies, familyPlansAvailable, contractType, form]);

  useEffect(() => {
    if (loadingAcademies || academies.length !== 1) return;
    const only = academies[0];
    if (!selectedAcademyId && only?.id) {
      form.setValue("academyId", only.id);
    }
  }, [loadingAcademies, academies, selectedAcademyId, form]);

  useEffect(() => {
    if (!showPaymentFields) {
      form.setValue("paymentMethod", undefined);
      form.setValue("installments", "1");
    }
  }, [showPaymentFields, form]);

  useEffect(() => {
    form.setValue("planId", "");
    form.setValue("trainingDays", undefined);
    form.setValue("paymentMethod", undefined);
    form.setValue("installments", "1");
  }, [registrationAudience, form]);

  const installmentInfo = useMemo(() => {
    if (!needsCardConfirm || !selectedPlan || !paymentMethod || paymentMethod === "boleto") {
      return null;
    }
    const total = planDisplayTotal(selectedPlan);
    const maxInstallments = Math.max(
      1,
      Number(selectedPlan.max_installments ?? (isNewStudent ? 12 : 1)),
    );
    const resolved = resolveInstallments({
      paymentMethod: paymentMethod as PrepaidPaymentMethod,
      requestedInstallments: Number(installmentsWatch || 1),
      allowsInstallments: paymentMethod === "cartao_credito",
      maxInstallments,
    });
    return {
      total,
      installments: resolved.installments,
      error: resolved.error,
      parcel: estimatedInstallmentAmount(total, resolved.installments),
      months: buildCoverageMonths(
        new Date().toISOString().slice(0, 10),
        Number(selectedPlan.duration_months ?? (isNewStudent ? 1 : 0)),
      ),
    };
  }, [needsCardConfirm, selectedPlan, paymentMethod, installmentsWatch, isNewStudent]);

  const scheduleAcademyId = selectedAcademyId || (academies.length === 1 ? academies[0]?.id : null);
  const { data: publicSchedules, isLoading: loadingSchedules } = usePublicClassSchedules(scheduleAcademyId);

  if (!loading && isAuthenticated) {
    return <Navigate to={getHomePath(roles)} replace />;
  }

  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>, onChange: (v: string) => void) => {
    const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 11);
    onChange(digitsOnly);
  };

  const onSubmit = async (values: SignupValues) => {
    if (requireTaxId && !isValidTaxId(values.billingTaxId || "")) {
      form.setError("billingTaxId", { message: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido" });
      return;
    }
    const audience = values.registrationAudience;
    if (!audience) {
      form.setError("registrationAudience", { message: "Selecione o tipo de aluno" });
      return;
    }

    let installments = 1;
    if (
      audience === "new_student" &&
      values.paymentMethod &&
      values.paymentMethod !== "boleto" &&
      selectedPlan
    ) {
      const resolved = resolveInstallments({
        paymentMethod: values.paymentMethod as PrepaidPaymentMethod,
        requestedInstallments: Number(values.installments || 1),
        allowsInstallments: values.paymentMethod === "cartao_credito",
        maxInstallments: Math.max(1, Number(selectedPlan.max_installments ?? 12)),
      });
      if (resolved.error) {
        form.setError("installments", { message: resolved.error });
        return;
      }
      installments = resolved.installments;
    }

    setSubmitting(true);
    const whatsapp = normalizeWhatsapp(values.whatsapp);

    try {
      await callEdgeFunction<{ success: boolean; message?: string }>(
        "register-student",
        {
          full_name: values.fullName.trim(),
          whatsapp,
          password: values.password,
          academy_id: values.academyId,
          belt: values.belt || "Branca",
          billing_tax_id: values.billingTaxId ? normalizeTaxId(values.billingTaxId) : null,
          plan_id: audience === "veterano" ? null : values.planId,
          birth_date: values.birthDate,
          guardian_name: values.guardianName?.trim() || null,
          payment_method: audience === "new_student" ? values.paymentMethod : null,
          installments:
            audience === "new_student" && values.paymentMethod !== "boleto"
              ? installments
              : null,
          registration_audience: audience,
          requested_training_days:
            audience === "veterano" && values.trainingDays
              ? Number(values.trainingDays)
              : null,
          contract_type: "individual",
        },
        { requireAuth: false },
      );

      toast({
        title: "Cadastro realizado",
        description:
          audience === "veterano"
            ? "Cadastro enviado para análise. Após aprovação, a academia pedirá mensal, semestral ou anual."
            : needsCardConfirm
              ? "Cadastro pendente. O pagamento na maquininha só libera após o administrador confirmar."
              : "Cadastro pendente de revisão. Você receberá WhatsApp de confirmação de recebimento.",
      });
      navigate("/login", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tente novamente.";
      toast({
        title: "Não foi possível criar a conta",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const noActivePlans =
    isNewStudent && !!selectedAcademyId && !loadingPlans && plans.length === 0;
  const showCreditInstallments = paymentMethod === "cartao_credito";
  const submitDisabled =
    submitting ||
    loadingAcademies ||
    (isNewStudent && (loadingPlans || noActivePlans)) ||
    !registrationAudience;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-lg rounded-3xl border border-border bg-card shadow-card overflow-hidden">
        <section className="gradient-primary p-8 text-primary-foreground text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-primary-foreground/80">Faith Brothers</p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-wide">Cadastro de Aluno</h1>
          <p className="mt-2 text-sm text-primary-foreground/85">
            Crie sua conta para acompanhar treinos, graduação e pagamentos
          </p>
        </section>

        <section className="p-8">
          {!loadingAcademies && familyPlansAvailable ? (
            <div className="mb-6 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Tipo de cadastro</p>
                <p className="text-xs text-muted-foreground">
                  Escolha se o cadastro é individual ou de um plano familiar.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  className="h-auto min-h-11 whitespace-normal px-3 py-3 text-sm"
                  variant={contractType === "individual" ? "default" : "outline"}
                  onClick={() => form.setValue("contractType", "individual")}
                >
                  Plano Individual
                </Button>
                <Button
                  type="button"
                  className="h-auto min-h-11 whitespace-normal px-3 py-3 text-sm"
                  variant={contractType === "familiar" ? "default" : "outline"}
                  onClick={() => form.setValue("contractType", "familiar")}
                >
                  Plano Familiar
                </Button>
              </div>
            </div>
          ) : null}

          {!loadingAcademies && familyPlansAvailable && contractType === "familiar" ? (
            <FamilyRegistrationWizard
              onBackToTypeChoice={() => form.setValue("contractType", "individual")}
            />
          ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="registrationAudience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Você já treina na Faith Brothers?</FormLabel>
                    <div className="grid grid-cols-1 gap-2">
                      <Button
                        type="button"
                        className="h-auto min-h-11 whitespace-normal px-3 py-3 text-sm"
                        variant={field.value === "new_student" ? "default" : "outline"}
                        onClick={() => field.onChange("new_student")}
                      >
                        Ainda não sou aluno / Quero iniciar
                      </Button>
                      <Button
                        type="button"
                        className="h-auto min-h-11 whitespace-normal px-3 py-3 text-sm"
                        variant={field.value === "veterano" ? "default" : "outline"}
                        onClick={() => field.onChange("veterano")}
                      >
                        Já sou aluno / Veterano
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome completo</FormLabel>
                    <FormControl>
                      <Input placeholder="Seu nome" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="whatsapp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        maxLength={11}
                        placeholder="31999999999"
                        value={field.value}
                        onChange={(e) => handleWhatsappChange(e, field.onChange)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">11 dígitos com DDD, sem espaços</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="birthDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de nascimento</FormLabel>
                    <FormControl>
                      <Input type="date" max={new Date().toISOString().slice(0, 10)} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="guardianName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Nome do responsável
                      {showGuardianRequired ? " *" : " (se menor de idade)"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={
                          showGuardianRequired
                            ? "Obrigatório para menores de 18 anos"
                            : "Opcional para maiores de idade"
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="billingTaxId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      CPF ou CNPJ de cobrança
                      {requireTaxId ? "" : " (opcional se entrar em família)"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        placeholder="Somente números"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 14))}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      CPF/CNPJ de cobrança individual. Não é exibido publicamente.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="academyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Academia</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || undefined}
                      disabled={loadingAcademies}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={loadingAcademies ? "Carregando..." : "Selecione a academia"} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {academies.map((academy) => (
                          <SelectItem key={academy.id} value={academy.id}>
                            {academy.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {scheduleAcademyId ? (
                <div className="rounded-xl border border-border bg-muted/30 p-4">
                  <ClassScheduleBoard
                    rows={(publicSchedules ?? []) as ClassScheduleRow[]}
                    loading={loadingSchedules}
                    title="Turmas e Horários"
                  />
                </div>
              ) : null}

              {isNewStudent ? (
                <FormField
                  control={form.control}
                  name="planId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Plano desejado (iniciante)</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || undefined}
                        disabled={!selectedAcademyId || loadingPlans || noActivePlans}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                !selectedAcademyId
                                  ? "Selecione a academia primeiro"
                                  : loadingPlans
                                    ? "Carregando planos..."
                                    : noActivePlans
                                      ? "Nenhum plano disponível"
                                      : "Selecione o plano"
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {plans.map((plan) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {formatPlanOptionLabel(plan)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Cadastro fica pendente de revisão. Pagamento só é aprovado depois (Asaas ou
                        confirmação do ADM na maquininha).
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {isVeteran ? (
                <FormField
                  control={form.control}
                  name="trainingDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequência semanal</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="2, 3 ou 5 dias" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {VETERAN_DAY_OPTIONS.map((days) => (
                            <SelectItem key={days} value={String(days)}>
                              {days} dias por semana
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Após a análise do cadastro, a academia pedirá mensal, semestral ou anual.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {isNewStudent ? (
                <>
                  <FormField
                    control={form.control}
                    name="paymentMethod"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Forma de pagamento</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.entries(NEW_STUDENT_PAYMENT_LABELS).map(([method, label]) => (
                              <SelectItem key={method} value={method}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {paymentMethod === "boleto" ? (
                          <p className="text-xs text-muted-foreground">
                            Fluxo Asaas: cobrança conforme calendário após aprovação do cadastro.
                          </p>
                        ) : needsCardConfirm ? (
                          <p className="text-xs text-muted-foreground">
                            Pagamento físico na maquininha. Só o administrador pode marcar como
                            aprovado.
                          </p>
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {showCreditInstallments ? (
                    <FormField
                      control={form.control}
                      name="installments"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Parcelas (maquininha)</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "1"}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Array.from(
                                {
                                  length: Math.max(
                                    1,
                                    Number(selectedPlan?.max_installments ?? 12),
                                  ),
                                },
                                (_, i) => i + 1,
                              ).map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                  {n}x
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}

                  {installmentInfo ? (
                    <div className="rounded-xl border border-border bg-secondary/40 p-3 text-sm space-y-1">
                      <p>
                        Total: <strong>{formatCurrency(installmentInfo.total)}</strong>
                      </p>
                      <p>
                        Parcelas (metadado): {installmentInfo.installments}x de{" "}
                        {formatCurrency(installmentInfo.parcel)}
                      </p>
                      {installmentInfo.months.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Após confirmação do admin:{" "}
                          {installmentInfo.months.map(formatCoverageMonthLabel).join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              <FormField
                control={form.control}
                name="belt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Graduação (faixa)</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a faixa" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {BELTS.map((belt) => (
                          <SelectItem key={belt} value={belt}>
                            {belt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senha</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmar senha</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitDisabled}>
                <UserPlus className="h-4 w-4" />
                {submitting ? "Criando conta..." : "Finalizar cadastro"}
              </Button>
            </form>
          </Form>
          )}

          <p className="mt-6 text-sm text-muted-foreground text-center">
            Já tem conta?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Fazer login
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
};

export default Cadastro;
