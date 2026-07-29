import { useEffect, useState } from "react";
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
import { callEdgeFunction } from "@/lib/api";
import { isValidBrazilianWhatsapp, normalizeWhatsapp } from "@/lib/whatsapp-auth";
import { isValidTaxId, normalizeTaxId } from "@/lib/tax-id";
import { formatPlanOptionLabel, type PlanOption } from "@/lib/plans";

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
    academyId: z.string().uuid("Selecione uma academia"),
    planId: z.string().uuid("Selecione o plano desejado"),
    billingTaxId: z
      .string()
      .trim()
      .min(1, "Informe o CPF ou CNPJ de cobrança")
      .refine((value) => isValidTaxId(value), {
        message: "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido",
      }),
    belt: z.string().optional(),
    password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(100),
    confirmPassword: z.string().min(8).max(100),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem",
  });

type SignupValues = z.infer<typeof signupSchema>;
type AcademyOption = { id: string; name: string; slug: string };

const Cadastro = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAuthenticated, loading, isStaff } = useAuth();
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
      academyId: "",
      planId: "",
      billingTaxId: "",
      belt: "Branca",
      password: "",
      confirmPassword: "",
    },
  });

  const selectedAcademyId = form.watch("academyId");

  useEffect(() => {
    const loadAcademies = async () => {
      const { data, error } = await supabase.rpc("get_public_academies");
      if (error) {
        toast({ title: "Não foi possível carregar as academias", description: error.message, variant: "destructive" });
      } else {
        setAcademies(data ?? []);
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

  if (!loading && isAuthenticated) {
    return <Navigate to={isStaff ? "/dashboard" : "/minha-presenca"} replace />;
  }

  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>, onChange: (v: string) => void) => {
    const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 11);
    onChange(digitsOnly);
  };

  const onSubmit = async (values: SignupValues) => {
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
          billing_tax_id: normalizeTaxId(values.billingTaxId),
          plan_id: values.planId,
        },
        { requireAuth: false },
      );

      toast({
        title: "Cadastro realizado",
        description: "Aguarde a aprovação da academia. Depois disso, faça login com seu WhatsApp e senha.",
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
                name="billingTaxId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPF ou CNPJ de cobrança</FormLabel>
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
                      Usado apenas para emissão de boletos. Não será exibido publicamente.
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
                    {noActivePlans ? (
                      <p className="text-sm text-warning">
                        Cadastre um plano ativo antes de vincular.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Você fica pendente até a academia aprovar. Nenhuma cobrança é gerada no cadastro.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

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
