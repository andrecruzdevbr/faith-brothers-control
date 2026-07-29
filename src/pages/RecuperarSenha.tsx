import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { normalizeWhatsapp } from "@/lib/whatsapp-auth";
import { callEdgeFunction } from "@/lib/api";

const FRIENDLY_OTP_MESSAGE =
  "Se o WhatsApp estiver cadastrado, enviaremos um código de recuperação.";

const requestSchema = z.object({
  whatsapp: z.string().trim().min(10, "Informe seu WhatsApp").max(13).regex(/^\d+$/, "Apenas números"),
});

const verifySchema = z.object({
  code: z.string().length(6, "O código deve ter 6 dígitos").regex(/^\d+$/, "Apenas números"),
  newPassword: z.string().min(8, "Mínimo 8 caracteres").max(100),
  confirmPassword: z.string().min(8).max(100),
}).refine(d => d.newPassword === d.confirmPassword, {
  path: ["confirmPassword"], message: "As senhas não conferem",
});

type ResetOtpResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  whatsapp?: {
    queued?: boolean;
    skipped?: boolean;
    reason?: string;
  };
};

const RecuperarSenha = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [whatsapp, setWhatsapp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const requestForm = useForm({ resolver: zodResolver(requestSchema), defaultValues: { whatsapp: "" } });
  const verifyForm = useForm({ resolver: zodResolver(verifySchema), defaultValues: { code: "", newPassword: "", confirmPassword: "" } });

  const handleWhatsappChange = (e: React.ChangeEvent<HTMLInputElement>, onChange: (v: string) => void) => {
    onChange(e.target.value.replace(/\D/g, ""));
  };

  const onRequestOtp = async (values: { whatsapp: string }) => {
    setSubmitting(true);
    const normalized = normalizeWhatsapp(values.whatsapp);
    try {
      const data = await callEdgeFunction<ResetOtpResponse>(
        "reset-password",
        { action: "request_otp", whatsapp: normalized },
        { requireAuth: false },
      );

      setWhatsapp(normalized);
      setStep("verify");

      const skipped = data.whatsapp?.skipped === true;
      toast({
        title: skipped ? "Solicitação registrada" : "Pronto",
        description: data.message ?? FRIENDLY_OTP_MESSAGE,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro de conexão";
      toast({ title: "Erro", description: message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const onVerifyOtp = async (values: { code: string; newPassword: string }) => {
    setSubmitting(true);
    try {
      await callEdgeFunction(
        "reset-password",
        {
          action: "verify_otp",
          whatsapp,
          code: values.code,
          new_password: values.newPassword,
        },
        { requireAuth: false },
      );
      toast({ title: "Senha alterada com sucesso!" });
      navigate("/login", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro de conexão";
      toast({ title: "Erro", description: message, variant: "destructive" });
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-border bg-card shadow-card overflow-hidden">
        <section className="gradient-primary p-8 text-primary-foreground text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-primary-foreground/80">Faith Brothers</p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-wide">Recuperar Senha</h1>
          <p className="mt-2 text-sm text-primary-foreground/85">
            {step === "request" ? "Informe seu WhatsApp para receber o código" : "Digite o código recebido"}
          </p>
        </section>

        <section className="p-8">
          {step === "request" ? (
            <Form {...requestForm}>
              <form onSubmit={requestForm.handleSubmit(onRequestOtp)} className="space-y-5">
                <FormField
                  control={requestForm.control}
                  name="whatsapp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>WhatsApp</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          placeholder="(DD) XXXXXXXXX"
                          value={field.value}
                          onChange={e => handleWhatsappChange(e, field.onChange)}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        {FRIENDLY_OTP_MESSAGE}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={submitting}>
                  <Send className="h-4 w-4" />
                  {submitting ? "Enviando..." : "Enviar código"}
                </Button>
              </form>
            </Form>
          ) : (
            <Form {...verifyForm}>
              <form onSubmit={verifyForm.handleSubmit(onVerifyOtp)} className="space-y-5">
                <FormField
                  control={verifyForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código de 6 dígitos</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="000000" maxLength={6} {...field} onChange={e => field.onChange(e.target.value.replace(/\D/g, ""))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={verifyForm.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nova senha</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={verifyForm.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmar nova senha</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={submitting}>
                  <ShieldCheck className="h-4 w-4" />
                  {submitting ? "Alterando..." : "Alterar senha"}
                </Button>
              </form>
            </Form>
          )}

          <p className="mt-6 text-sm text-muted-foreground text-center">
            <Link to="/login" className="font-medium text-primary hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Voltar ao login
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
};

export default RecuperarSenha;
