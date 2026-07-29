import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { normalizeWhatsapp } from "@/lib/whatsapp-auth";
import { callEdgeFunction } from "@/lib/api";

const FRIENDLY_OTP_MESSAGE =
  "Se o WhatsApp estiver cadastrado, enviaremos um código de recuperação.";

const OTP_LENGTH = 6;

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

/** Digits-only helper used by inputs and tests. */
export function digitsOnly(value: string, maxLength?: number): string {
  const digits = value.replace(/\D/g, "");
  return typeof maxLength === "number" ? digits.slice(0, maxLength) : digits;
}

/** Ensures OTP code state never inherits WhatsApp values. */
export function createEmptyVerifyFields() {
  return {
    code: "",
    newPassword: "",
    confirmPassword: "",
  };
}

const RecuperarSenha = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [submitting, setSubmitting] = useState(false);

  // Estados totalmente separados — nunca compartilhar value/onChange entre campos
  const [whatsapp, setWhatsapp] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const resetVerifyFields = () => {
    const empty = createEmptyVerifyFields();
    setCode(empty.code);
    setNewPassword(empty.newPassword);
    setConfirmPassword(empty.confirmPassword);
    setFieldError(null);
  };

  const onRequestOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);

    const normalized = normalizeWhatsapp(whatsapp);
    if (!/^\d{10,11}$/.test(normalized)) {
      setFieldError("Informe um WhatsApp válido com DDD (10 ou 11 dígitos).");
      return;
    }

    setSubmitting(true);
    try {
      const data = await callEdgeFunction<ResetOtpResponse>(
        "reset-password",
        { action: "request_otp", whatsapp: normalized },
        { requireAuth: false },
      );

      // Guarda WhatsApp para o verify_otp, mas limpa o código
      setWhatsapp(normalized);
      resetVerifyFields();
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

  const onVerifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);

    const cleanCode = digitsOnly(code, OTP_LENGTH);
    if (cleanCode.length !== OTP_LENGTH) {
      setFieldError("O código deve ter 6 dígitos.");
      return;
    }
    if (newPassword.length < 8) {
      setFieldError("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldError("As senhas não conferem.");
      return;
    }

    setSubmitting(true);
    try {
      await callEdgeFunction(
        "reset-password",
        {
          action: "verify_otp",
          whatsapp,
          code: cleanCode,
          new_password: newPassword,
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

  const goBackToWhatsapp = () => {
    resetVerifyFields();
    setStep("request");
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
            <form
              key="request-step"
              onSubmit={onRequestOtp}
              className="space-y-5"
              autoComplete="on"
            >
              <div className="space-y-2">
                <Label htmlFor="reset-whatsapp">WhatsApp</Label>
                <Input
                  id="reset-whatsapp"
                  name="reset-whatsapp"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="(DD) XXXXXXXXX"
                  value={whatsapp}
                  disabled={submitting}
                  onChange={(e) => {
                    setWhatsapp(digitsOnly(e.target.value, 13));
                    // Alterar WhatsApp nunca preenche o código
                    setCode("");
                  }}
                />
                <p className="text-xs text-muted-foreground">{FRIENDLY_OTP_MESSAGE}</p>
              </div>

              {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}

              <Button type="submit" className="w-full" disabled={submitting}>
                <Send className="h-4 w-4" />
                {submitting ? "Enviando..." : "Enviar código"}
              </Button>
            </form>
          ) : (
            <form
              key={`verify-step-${whatsapp}`}
              onSubmit={onVerifyOtp}
              className="space-y-5"
              autoComplete="off"
            >
              <div className="space-y-2">
                <Label htmlFor="reset-otp-code">Código de 6 dígitos</Label>
                <Input
                  id="reset-otp-code"
                  name="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={OTP_LENGTH}
                  value={code}
                  disabled={submitting}
                  readOnly={false}
                  onChange={(e) => setCode(digitsOnly(e.target.value, OTP_LENGTH))}
                />
                <p className="text-xs text-muted-foreground">
                  Código enviado para o WhatsApp terminado em {whatsapp.slice(-4)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-new-password">Nova senha</Label>
                <Input
                  id="reset-new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={newPassword}
                  disabled={submitting}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirmar nova senha</Label>
                <Input
                  id="reset-confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  disabled={submitting}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}

              <Button type="submit" className="w-full" disabled={submitting}>
                <ShieldCheck className="h-4 w-4" />
                {submitting ? "Alterando..." : "Alterar senha"}
              </Button>

              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-primary"
                onClick={goBackToWhatsapp}
                disabled={submitting}
              >
                Usar outro WhatsApp / reenviar código
              </button>
            </form>
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
