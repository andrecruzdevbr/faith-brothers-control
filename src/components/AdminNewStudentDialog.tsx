import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NewStudentPlanAccordion } from "@/components/NewStudentPlanAccordion";
import { FamilyRegistrationWizard } from "@/components/family/FamilyRegistrationWizard";
import { useToast } from "@/hooks/use-toast";
import { callEdgeFunction, formatCurrency } from "@/lib/api";
import { buildAdminRegisterStudentBody } from "@/lib/admin-new-student";
import { BELTS } from "@/lib/constants";
import { isValidBrazilianWhatsapp, normalizeWhatsapp } from "@/lib/whatsapp-auth";
import { isValidTaxId, normalizeTaxId } from "@/lib/tax-id";
import { type PlanOption } from "@/lib/plans";
import { isPublicFamilySignupEnabled } from "@/lib/family-catalog-flags";
import { isMinor, validateStudentBirthFields } from "@/lib/student-age";
import {
  buildCoverageMonths,
  estimatedInstallmentAmount,
  formatCoverageMonthLabel,
  planDisplayTotal,
  resolveInstallments,
  type PrepaidPaymentMethod,
} from "@/lib/prepaid-contracts";
import {
  NEW_STUDENT_PAYMENT_LABELS,
  VETERAN_DAY_OPTIONS,
  filterPlansForRegistrationAudience,
  paymentMethodsForNewStudentPlan,
  requiresAdminPaymentConfirmation,
  type RegistrationAudience,
} from "@/lib/registration-flows";
import { supabase } from "@/integrations/supabase/client";

const adminSignupSchema = z
  .object({
    fullName: z.string().trim().min(3, "Informe o nome completo").max(120),
    whatsapp: z
      .string()
      .trim()
      .regex(/^\d+$/, "Apenas números são permitidos")
      .refine((value) => isValidBrazilianWhatsapp(value), {
        message: "Informe um WhatsApp com 11 dígitos (DDD + número)",
      }),
    birthDate: z.string().min(1, "Informe a data de nascimento."),
    guardianName: z.string().trim().max(120).optional().or(z.literal("")),
    planId: z.string().uuid("Selecione o plano desejado").optional().or(z.literal("")),
    billingTaxId: z.string().trim().min(11, "Informe CPF ou CNPJ"),
    belt: z.string().optional(),
    registrationAudience: z.enum(["new_student", "veterano"]).optional(),
    trainingDays: z.enum(["2", "3", "5"]).optional(),
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
    if (!isValidTaxId(data.billingTaxId || "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido",
        path: ["billingTaxId"],
      });
    }
    if (!data.registrationAudience) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selecione se é iniciante ou veterano",
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
        message: "Escolha 1, 2, 3 ou 5 dias",
        path: ["trainingDays"],
      });
    }
  });

type AdminSignupValues = z.infer<typeof adminSignupSchema>;

function mapPublicPlans(rows: unknown[]): PlanOption[] {
  return (rows ?? []).map((raw) => {
    const p = raw as PlanOption;
    return {
      id: p.id,
      name: p.name,
      monthly_price: Number(p.monthly_price),
      training_days_per_week: p.training_days_per_week,
      audience: p.audience,
      plan_kind: p.plan_kind,
      duration_months: p.duration_months ?? 1,
      reference_monthly_price: p.reference_monthly_price,
      package_total_amount: p.package_total_amount,
      billing_mode: p.billing_mode ?? "asaas_monthly",
      allows_installments: p.allows_installments ?? false,
      max_installments: p.max_installments ?? 1,
      description: p.description,
    };
  });
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  academyId: string;
  onCreated: () => void;
};

export function AdminNewStudentDialog({ open, onOpenChange, academyId, onCreated }: Props) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [contractType, setContractType] = useState<"individual" | "familiar">("individual");
  const [familyEnabled, setFamilyEnabled] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const form = useForm<AdminSignupValues>({
    resolver: zodResolver(adminSignupSchema),
    defaultValues: {
      fullName: "",
      whatsapp: "",
      birthDate: "",
      guardianName: "",
      planId: "",
      billingTaxId: "",
      belt: "Branca",
      registrationAudience: undefined,
      trainingDays: undefined,
      paymentMethod: undefined,
      installments: "1",
    },
  });

  const registrationAudience = form.watch("registrationAudience") as RegistrationAudience | undefined;
  const selectedPlanId = form.watch("planId");
  const birthDateWatch = form.watch("birthDate");
  const paymentMethod = form.watch("paymentMethod");
  const installmentsWatch = form.watch("installments");
  const showGuardianRequired = !!birthDateWatch && isMinor(birthDateWatch);
  const isNewStudent = registrationAudience === "new_student";
  const isVeteran = registrationAudience === "veterano";
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const paymentMethodOptions = useMemo(
    () => paymentMethodsForNewStudentPlan(selectedPlan),
    [selectedPlan],
  );
  const needsCardConfirm = requiresAdminPaymentConfirmation(paymentMethod);

  useEffect(() => {
    if (!open || !academyId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("academy_billing_settings")
        .select("family_plans_enabled, prepaid_contracts_enabled")
        .eq("academy_id", academyId)
        .maybeSingle();
      if (error) {
        if (!cancelled) setFamilyEnabled(false);
        return;
      }
      if (!cancelled) setFamilyEnabled(isPublicFamilySignupEnabled(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, academyId]);

  useEffect(() => {
    if (!open) {
      form.reset();
      setContractType("individual");
      setPlans([]);
    }
  }, [open, form]);

  useEffect(() => {
    if (!open || !academyId || !isNewStudent) {
      setPlans([]);
      setLoadingPlans(false);
      return;
    }
    let cancelled = false;
    const loadPlans = async () => {
      setLoadingPlans(true);
      const { data, error } = await supabase.rpc("get_public_active_plans", {
        _academy_id: academyId,
        _audience: "new_student",
      });
      if (cancelled) return;
      if (error) {
        const fallback = await supabase.rpc("get_public_active_plans", {
          _academy_id: academyId,
        });
        if (fallback.error) {
          toast({
            title: "Não foi possível carregar os planos",
            description: fallback.error.message,
            variant: "destructive",
          });
          setPlans([]);
        } else {
          setPlans(filterPlansForRegistrationAudience(mapPublicPlans(fallback.data ?? []), "new_student"));
        }
      } else {
        setPlans(mapPublicPlans(data ?? []));
      }
      setLoadingPlans(false);
    };
    void loadPlans();
    return () => {
      cancelled = true;
    };
  }, [open, academyId, isNewStudent, toast]);

  useEffect(() => {
    if (!paymentMethod) return;
    if (!paymentMethodOptions.includes(paymentMethod)) {
      form.setValue("paymentMethod", undefined);
    }
  }, [paymentMethod, paymentMethodOptions, form]);

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
    const maxInstallments = Math.max(1, Number(selectedPlan.max_installments ?? 12));
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
        Number(selectedPlan.duration_months ?? 1),
      ),
    };
  }, [needsCardConfirm, selectedPlan, paymentMethod, installmentsWatch]);

  const onSubmit = async (values: AdminSignupValues) => {
    const audience = values.registrationAudience;
    if (!audience) return;

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
    try {
      const body = buildAdminRegisterStudentBody({
        fullName: values.fullName,
        whatsapp: normalizeWhatsapp(values.whatsapp),
        academyId,
        belt: values.belt || "Branca",
        billingTaxId: normalizeTaxId(values.billingTaxId),
        birthDate: values.birthDate,
        guardianName: values.guardianName,
        registrationAudience: audience,
        planId: values.planId,
        paymentMethod: values.paymentMethod,
        installments,
        trainingDays: values.trainingDays ? Number(values.trainingDays) : null,
      });

      await callEdgeFunction("register-student", body, { requireAuth: true });

      toast({
        title: "Aluno cadastrado",
        description:
          audience === "veterano"
            ? "Cadastro aprovado. Plano e pagamento aguardam definição pela equipe."
            : needsCardConfirm
              ? "Cadastro aprovado. Pagamento aguarda conferência do administrador."
              : "Cadastro aprovado cadastralmente. Financeiro segue as regras do plano.",
      });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast({
        title: "Não foi possível cadastrar",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const noActivePlans = isNewStudent && !loadingPlans && plans.length === 0;
  const showCreditInstallments = paymentMethod === "cartao_credito";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Novo aluno</DialogTitle>
          <DialogDescription>
            Mesmas regras do cadastro oficial. Aprovação cadastral ao concluir; pagamento permanece
            separado.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-5.5rem)] px-6 pb-6">
          {familyEnabled ? (
            <div className="mb-4 space-y-2">
              <p className="text-sm font-medium">Tipo</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={contractType === "individual" ? "default" : "outline"}
                  className="h-auto min-h-10 whitespace-normal px-2 py-2 text-sm"
                  onClick={() => setContractType("individual")}
                >
                  Individual
                </Button>
                <Button
                  type="button"
                  variant={contractType === "familiar" ? "default" : "outline"}
                  className="h-auto min-h-10 whitespace-normal px-2 py-2 text-sm"
                  onClick={() => setContractType("familiar")}
                >
                  Familiar
                </Button>
              </div>
            </div>
          ) : null}

          {familyEnabled && contractType === "familiar" ? (
            <FamilyRegistrationWizard
              adminCreated
              lockedAcademyId={academyId}
              onBackToTypeChoice={() => setContractType("individual")}
              onSuccess={() => {
                onOpenChange(false);
                onCreated();
              }}
            />
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="registrationAudience"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de aluno</FormLabel>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          type="button"
                          className="h-auto min-h-11 whitespace-normal px-3 py-3 text-sm"
                          variant={field.value === "new_student" ? "default" : "outline"}
                          onClick={() => field.onChange("new_student")}
                        >
                          Ainda não é aluno / Iniciante
                        </Button>
                        <Button
                          type="button"
                          className="h-auto min-h-11 whitespace-normal px-3 py-3 text-sm"
                          variant={field.value === "veterano" ? "default" : "outline"}
                          onClick={() => field.onChange("veterano")}
                        >
                          Já é aluno / Veterano
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
                        <Input placeholder="Nome do aluno" {...field} />
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
                          onChange={(e) =>
                            field.onChange(e.target.value.replace(/\D/g, "").slice(0, 11))
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
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
                        {showGuardianRequired ? " *" : " (se menor)"}
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                      <FormLabel>CPF ou CNPJ de cobrança</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          placeholder="Somente números"
                          value={field.value}
                          onChange={(e) =>
                            field.onChange(e.target.value.replace(/\D/g, "").slice(0, 14))
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="belt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Faixa</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "Branca"}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BELTS.map((b) => (
                            <SelectItem key={b} value={b}>
                              {b}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Graus não são solicitados no cadastro.</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isNewStudent ? (
                  <FormField
                    control={form.control}
                    name="planId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="sr-only">Plano</FormLabel>
                        {loadingPlans ? (
                          <p className="text-sm text-muted-foreground">Carregando planos...</p>
                        ) : noActivePlans ? (
                          <p className="text-sm text-muted-foreground">Nenhum plano disponível.</p>
                        ) : (
                          <NewStudentPlanAccordion
                            plans={plans}
                            value={field.value}
                            onChange={(planId) => {
                              field.onChange(planId);
                              form.setValue("paymentMethod", undefined);
                              form.setValue("installments", "1");
                            }}
                          />
                        )}
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
                        <FormLabel>Frequência pretendida</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="2, 3 ou 5 dias" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {VETERAN_DAY_OPTIONS.map((days) => (
                              <SelectItem key={days} value={String(days)}>
                                {`${days} dias por semana`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Plano e pagamento: aguardando definição. Sem catálogo new_student e sem
                          preços nesta etapa.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                {isNewStudent && selectedPlanId ? (
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
                              {paymentMethodOptions.map((method) => (
                                <SelectItem key={method} value={method}>
                                  {NEW_STUDENT_PAYMENT_LABELS[method] ?? method}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {needsCardConfirm ? (
                            <p className="text-xs text-muted-foreground">
                              Fica em aguardando conferência até “Pagamento aprovado”.
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
                            <FormLabel>Parcelas</FormLabel>
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
                          {installmentInfo.installments}x de {formatCurrency(installmentInfo.parcel)}
                        </p>
                        {installmentInfo.months.length > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Após confirmação:{" "}
                            {installmentInfo.months.map(formatCoverageMonthLabel).join(", ")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}

                <p className="text-xs text-muted-foreground">
                  Conta de acesso: senha aleatória no servidor. O aluno usa “Esqueci minha senha”.
                </p>

                <Button
                  type="submit"
                  className="w-full gradient-primary text-primary-foreground"
                  disabled={submitting || !registrationAudience || (isNewStudent && (loadingPlans || noActivePlans))}
                >
                  {submitting ? "Cadastrando..." : "Cadastrar aluno"}
                </Button>
              </form>
            </Form>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
