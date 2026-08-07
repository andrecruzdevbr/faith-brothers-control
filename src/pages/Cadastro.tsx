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
  PREPAID_PAYMENT_METHOD_LABELS,
  buildCoverageMonths,
  estimatedInstallmentAmount,
  formatCoverageMonthLabel,
  isMachineBillingMode,
  planDisplayTotal,
  resolveInstallments,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";
import { FamilyRegistrationWizard } from "@/components/family/FamilyRegistrationWizard";

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
    planId: z.string().uuid("Selecione o plano desejado"),
    billingTaxId: z.string().trim().optional().or(z.literal("")),
    belt: z.string().optional(),
    password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(100),
    confirmPassword: z.string().min(8).max(100),
    contractType: z.enum(["individual", "familiar"]),
    familyMode: z.enum(["create", "join"]).optional(),
    familyName: z.string().trim().max(120).optional().or(z.literal("")),
    familyInviteCode: z.string().trim().max(20).optional().or(z.literal("")),
    familyRelationship: z.string().trim().max(40).optional().or(z.literal("")),
    estimatedMemberCount: z.string().optional().or(z.literal("")),
    financialResponsibleName: z.string().trim().max(120).optional().or(z.literal("")),
    paymentMethod: z
      .enum(["cartao_credito", "cartao_debito", "pix", "dinheiro"])
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
  const paymentMethod = form.watch("paymentMethod");
  const installmentsWatch = form.watch("installments");
  const showGuardianRequired = !!birthDateWatch && isMinor(birthDateWatch);

  const selectedAcademy = academies.find((a) => a.id === selectedAcademyId);
  const prepaidEnabled = !!selectedAcademy?.prepaid_contracts_enabled;
  const familyEnabled = !!selectedAcademy?.family_plans_enabled;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const machinePlan = isMachineBillingMode(selectedPlan?.billing_mode);
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
    if (!selectedAcademyId) {
      setPlans([]);
      setLoadingPlans(false);
      return;
    }

    let cancelled = false;
    const loadPlans = async () => {
      setLoadingPlans(true);
      const { data, error } = await supabase.rpc("get_public_active_plans", {
        _academy_id: selectedAcademyId,
      });
      if (cancelled) return;
      if (error) {
        toast({
          title: "Não foi possível carregar os planos",
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
  }, [selectedAcademyId, form, toast]);

  useEffect(() => {
    if (!familyEnabled && contractType === "familiar") {
      form.setValue("contractType", "individual");
    }
  }, [familyEnabled, contractType, form]);

  useEffect(() => {
    if (!machinePlan) {
      form.setValue("paymentMethod", undefined);
      form.setValue("installments", "1");
    }
  }, [machinePlan, form]);

  const installmentInfo = useMemo(() => {
    if (!machinePlan || !selectedPlan || !paymentMethod) return null;
    const total = planDisplayTotal(selectedPlan);
    const resolved = resolveInstallments({
      paymentMethod: paymentMethod as PrepaidPaymentMethod,
      requestedInstallments: Number(installmentsWatch || 1),
      allowsInstallments: !!selectedPlan.allows_installments,
      maxInstallments: selectedPlan.max_installments ?? 1,
    });
    return {
      total,
      installments: resolved.installments,
      error: resolved.error,
      parcel: estimatedInstallmentAmount(total, resolved.installments),
      months: buildCoverageMonths(
        new Date().toISOString().slice(0, 10),
        Number(selectedPlan.duration_months ?? 0),
      ),
    };
  }, [machinePlan, selectedPlan, paymentMethod, installmentsWatch]);

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
    if (machinePlan && !values.paymentMethod) {
      form.setError("paymentMethod", { message: "Selecione a forma de pagamento" });
      return;
    }
    let installments = 1;
    if (machinePlan && values.paymentMethod && selectedPlan) {
      const resolved = resolveInstallments({
        paymentMethod: values.paymentMethod,
        requestedInstallments: Number(values.installments || 1),
        allowsInstallments: !!selectedPlan.allows_installments,
        maxInstallments: selectedPlan.max_installments ?? 1,
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
          plan_id: values.planId,
          birth_date: values.birthDate,
          guardian_name: values.guardianName?.trim() || null,
          payment_method: machinePlan ? values.paymentMethod : null,
          installments: machinePlan ? installments : null,
          contract_type: "individual",
        },
        { requireAuth: false },
      );

      toast({
        title: "Cadastro realizado",
        description:
          machinePlan
            ? "Aguarde a academia confirmar o pagamento. Nenhum boleto é gerado no cadastro."
            : "Aguarde a aprovação da academia. Depois disso, faça login com seu WhatsApp e senha.",
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

  const noActivePlans = !!selectedAcademyId && !loadingPlans && plans.length === 0;
  const showCreditInstallments =
    machinePlan &&
    paymentMethod === "cartao_credito" &&
    !!selectedPlan?.allows_installments &&
    (selectedPlan.max_installments ?? 1) > 1;

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
          {familyEnabled ? (
            <div className="mb-6 space-y-2">
              <p className="text-sm font-medium">Escolha do plano</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={contractType === "individual" ? "default" : "outline"}
                  onClick={() => form.setValue("contractType", "individual")}
                >
                  Individual
                </Button>
                <Button
                  type="button"
                  variant={contractType === "familiar" ? "default" : "outline"}
                  onClick={() => form.setValue("contractType", "familiar")}
                >
                  Familiar
                </Button>
              </div>
            </div>
          ) : null}

          {familyEnabled && contractType === "familiar" ? (
            <FamilyRegistrationWizard
              onBackToTypeChoice={() => form.setValue("contractType", "individual")}
            />
          ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

              <FormField
                control={form.control}
                name="planId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plano desejado</FormLabel>
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
                    {selectedPlan?.description ? (
                      <p className="text-xs text-muted-foreground">{selectedPlan.description}</p>
                    ) : machinePlan ? (
                      <p className="text-xs text-muted-foreground">
                        Pagamento na academia. Parcelas do cartão são só informação da maquininha — o mês
                        da data de início conta inteiro (mesmo começando no meio do mês).
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Você fica pendente até a academia aprovar. Nenhuma cobrança é gerada no cadastro.
                      </p>
                    )}
                    {!prepaidEnabled && selectedAcademyId ? (
                      <p className="text-xs text-muted-foreground">
                        Pacotes antecipados ainda não estão habilitados nesta academia.
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {machinePlan ? (
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
                            {(Object.keys(PREPAID_PAYMENT_METHOD_LABELS) as PrepaidPaymentMethod[]).map(
                              (method) => (
                                <SelectItem key={method} value={method}>
                                  {PREPAID_PAYMENT_METHOD_LABELS[method]}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
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
                                { length: selectedPlan?.max_installments ?? 1 },
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
                          Após confirmação do admin, meses liberados (exemplo a partir de hoje):{" "}
                          {installmentInfo.months.map(formatCoverageMonthLabel).join(", ")}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Avulso: não cria meses futuros nem entra no cron de boletos.
                        </p>
                      )}
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

              <Button
                type="submit"
                className="w-full"
                disabled={submitting || loadingAcademies || loadingPlans || noActivePlans}
              >
                <UserPlus className="h-4 w-4" />
                {submitting ? "Criando conta..." : "Criar conta"}
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
