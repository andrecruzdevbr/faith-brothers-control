import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { getHomePath } from "@/lib/access";
import { isValidWhatsapp } from "@/lib/whatsapp-auth";

const loginSchema = z.object({
  whatsapp: z
    .string()
    .trim()
    .min(10, "Informe seu WhatsApp (apenas números)")
    .max(13)
    .regex(/^\d+$/, "Apenas números são permitidos")
    .refine(isValidWhatsapp, "WhatsApp inválido — use DDD + número (10 ou 11 dígitos)"),
  password: z.string().trim().min(8, "A senha precisa ter pelo menos 8 caracteres").max(100),
});

type LoginValues = z.infer<typeof loginSchema>;

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, loading, roles, signInWithWhatsapp } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { whatsapp: "", password: "" },
  });

  if (!loading && isAuthenticated) {
    return <Navigate to={getHomePath(roles)} replace />;
  }

  const onSubmit = async (values: LoginValues) => {
    setSubmitting(true);

    try {
      await signInWithWhatsapp(values.whatsapp, values.password);

      const from = (location.state as { from?: { pathname: string } })?.from?.pathname;
      navigate(from ?? "/", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      const isInvalidCredentials = /invalid login credentials/i.test(message);

      toast({
        title: "Não foi possível entrar",
        description: isInvalidCredentials
          ? "WhatsApp ou senha incorretos."
          : message,
        variant: "destructive",
      });

      form.setValue("password", "");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-border bg-card shadow-card overflow-hidden">

        <section className="gradient-primary p-8 text-primary-foreground text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-primary-foreground/80">Faith Brothers</p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-wide">Acesse sua conta</h1>
          <p className="mt-2 text-sm text-primary-foreground/85">Entre com seu WhatsApp e senha</p>
        </section>

        <section className="p-8">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-5"
              autoComplete="on"
            >
              <FormField
                control={form.control}
                name="whatsapp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp</FormLabel>
                    <FormControl>
                      <input
                        name="whatsapp"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="username"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-lpignore="true"
                        data-1p-ignore="true"
                        placeholder="31999999999"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">DDD + número, somente dígitos</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        placeholder="••••••••"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={submitting}>
                <LogIn className="h-4 w-4" />
                {submitting ? "Entrando..." : "Entrar"}
              </Button>
            </form>
          </Form>

          <div className="mt-4 text-center">
            <Link to="/recuperar-senha" className="text-sm font-medium text-primary hover:underline">
              Esqueci minha senha
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground text-center">
            Ainda não tem conta?{" "}
            <Link to="/cadastro" className="font-medium text-primary hover:underline">
              Criar cadastro
            </Link>
          </p>
        </section>

      </div>
    </div>
  );
};

export default Login;
