import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  MapPin,
  Send,
  CheckCircle,
  XCircle,
  Loader2,
  MessageSquare,
  AlertCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAcademySettings, useAcademyId } from "@/hooks/useQueries";
import { callEdgeFunction, formatDateBR } from "@/lib/api";
import { formatWhatsapp } from "@/lib/whatsapp-auth";
import { formatAsaasEnvironmentLabel } from "@/lib/academy-finance";
import { supabase } from "@/integrations/supabase/client";

type WhatsAppMessage = {
  id: string;
  recipient: string;
  body: string;
  message_type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  sent: "Enviado",
  failed: "Falhou",
  confirmed: "Confirmado",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  processing: "secondary",
  sent: "default",
  failed: "destructive",
  confirmed: "default",
};

const ConfiguracoesSkeleton = () => (
  <div className="space-y-6">
    <Skeleton className="h-10 w-56" />
    <Skeleton className="h-64 rounded-xl" />
    <Skeleton className="h-48 rounded-xl" />
    <Skeleton className="h-72 rounded-xl" />
  </div>
);

const Configuracoes = () => {
  const { toast } = useToast();
  const { data: settings, isLoading, isError, error } = useAcademySettings();
  const { data: academyId } = useAcademyId();

  const [testNumber, setTestNumber] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ success: boolean; details: string } | null>(null);

  const {
    data: messages,
    isLoading: messagesLoading,
  } = useQuery({
    queryKey: ["whatsapp-messages", academyId],
    enabled: !!academyId,
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("whatsapp_messages")
        .select("id, recipient, body, message_type, status, error_message, sent_at, created_at")
        .eq("academy_id", academyId!)
        .order("created_at", { ascending: false })
        .limit(50);

      if (queryError) throw queryError;
      return (data ?? []) as WhatsAppMessage[];
    },
  });

  const handleTestWhatsApp = async () => {
    const cleaned = testNumber.replace(/\D/g, "");
    if (cleaned.length < 10 || cleaned.length > 13) {
      toast({
        title: "Número inválido",
        description: "Digite DDD + número (ex: 11999999999).",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    setLastResult(null);

    try {
      const data = await callEdgeFunction<{ success: boolean; number?: string; error?: string }>(
        "send-whatsapp",
        {
          numero: cleaned,
          mensagem: "Teste de integração WhatsApp OK 👊\n\nFaith Brothers Brazilian Jiu-Jitsu 🥋",
        },
      );

      if (data.success) {
        setLastResult({ success: true, details: `Enviado para ${formatWhatsapp(data.number ?? cleaned)}` });
        toast({ title: "Mensagem enviada!", description: "Verifique o WhatsApp." });
      } else {
        setLastResult({ success: false, details: data.error ?? "Erro desconhecido" });
        toast({ title: "Erro ao enviar", description: data.error, variant: "destructive" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro de conexão";
      setLastResult({ success: false, details: msg });
      toast({ title: "Erro de conexão", description: msg, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return <ConfiguracoesSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">CONFIGURAÇÕES</h1>
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error instanceof Error ? error.message : "Erro ao carregar configurações."}</p>
        </div>
      </div>
    );
  }

  const academy = settings?.academy;
  const billing = settings?.billing;
  const cityState = [academy?.city, academy?.state].filter(Boolean).join(" — ");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">CONFIGURAÇÕES</h1>
        <p className="text-sm text-muted-foreground mt-1">Dados da academia e integrações</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="h-6 w-6 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">DADOS DA ACADEMIA</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-3">
            <div>
              <span className="text-muted-foreground">Nome:</span>{" "}
              <span className="text-foreground font-medium">{academy?.name ?? "—"}</span>
            </div>
            {cityState && (
              <div>
                <span className="text-muted-foreground">Cidade:</span>{" "}
                <span className="text-foreground font-medium">{cityState}</span>
              </div>
            )}
            {academy?.address && (
              <div className="flex items-start gap-1">
                <span className="text-muted-foreground">Endereço:</span>
                <span className="text-foreground font-medium flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                  {academy.address}
                </span>
              </div>
            )}
            {academy?.finance_whatsapp && (
              <div>
                <span className="text-muted-foreground">WhatsApp financeiro:</span>{" "}
                <span className="text-foreground font-medium">{formatWhatsapp(academy.finance_whatsapp)}</span>
              </div>
            )}
            {academy?.finance_contact_name && (
              <div>
                <span className="text-muted-foreground">Contato financeiro:</span>{" "}
                <span className="text-foreground font-medium">{academy.finance_contact_name}</span>
              </div>
            )}
            {academy?.finance_document_display && (
              <div>
                <span className="text-muted-foreground">CNPJ/MEI:</span>{" "}
                <span className="text-foreground font-medium">{academy.finance_document_display}</span>
              </div>
            )}
          </div>
          <div className="space-y-3">
            {billing?.boleto_due_day != null && (
              <div>
                <span className="text-muted-foreground">Vencimento padrão:</span>{" "}
                <span className="text-foreground font-medium">Dia {billing.boleto_due_day}</span>
              </div>
            )}
            {billing?.boleto_issue_day != null && (
              <div>
                <span className="text-muted-foreground">Emissão de cobrança:</span>{" "}
                <span className="text-foreground font-medium">Dia {billing.boleto_issue_day}</span>
              </div>
            )}
            {billing?.send_whatsapp_automatically != null && (
              <div>
                <span className="text-muted-foreground">WhatsApp automático:</span>{" "}
                <span className="text-foreground font-medium">
                  {billing.send_whatsapp_automatically ? "Ativado" : "Desativado"}
                </span>
              </div>
            )}
            {academy?.bank_name && (
              <div>
                <span className="text-muted-foreground">Banco:</span>{" "}
                <span className="text-foreground font-medium">
                  {academy.bank_name}
                  {academy.bank_code ? ` (${academy.bank_code})` : ""}
                </span>
              </div>
            )}
            {(academy?.bank_branch || academy?.bank_account) && (
              <div>
                <span className="text-muted-foreground">Conta:</span>{" "}
                <span className="text-foreground font-medium">
                  {academy.bank_branch ? `Ag ${academy.bank_branch}` : ""}
                  {academy.bank_branch && academy.bank_account ? " • " : ""}
                  {academy.bank_account ? `Cc ${academy.bank_account}` : ""}
                </span>
              </div>
            )}
            {academy?.asaas_environment_label && (
              <div>
                <span className="text-muted-foreground">Asaas:</span>{" "}
                <span className="text-foreground font-medium">
                  {formatAsaasEnvironmentLabel(academy.asaas_environment_label)}
                </span>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="flex items-center gap-3 mb-6">
          <Send className="h-6 w-6 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">TESTAR WHATSAPP</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Envie uma mensagem de teste para validar a integração com a Evolution API.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="(DD) XXXXXXXXX"
            inputMode="numeric"
            value={testNumber}
            onChange={(e) => setTestNumber(e.target.value.replace(/\D/g, ""))}
            className="max-w-xs bg-background"
          />
          <Button onClick={handleTestWhatsApp} disabled={sending || !testNumber}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Enviando..." : "Testar WhatsApp"}
          </Button>
        </div>

        {lastResult && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-lg p-3 text-sm ${
              lastResult.success
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            }`}
          >
            {lastResult.success ? (
              <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium">{lastResult.success ? "Sucesso!" : "Falha no envio"}</p>
              <p className="text-xs mt-0.5 opacity-80">{lastResult.details}</p>
            </div>
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-border bg-card shadow-card overflow-hidden"
      >
        <div className="p-5 border-b border-border flex items-center gap-3">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold tracking-wider">HISTÓRICO DE MENSAGENS</h3>
        </div>

        {messagesLoading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : !messages?.length ? (
          <p className="p-8 text-sm text-muted-foreground text-center">Nenhuma mensagem registrada.</p>
        ) : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-secondary/80 backdrop-blur-sm">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Destinatário
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Tipo
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    Data
                  </th>
                </tr>
              </thead>
              <tbody>
                {messages.map((msg) => (
                  <tr key={msg.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{formatWhatsapp(msg.recipient)}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px] md:max-w-xs">{msg.body}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                      {msg.message_type}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[msg.status] ?? "outline"}>
                        {STATUS_LABELS[msg.status] ?? msg.status}
                      </Badge>
                      {msg.error_message && (
                        <p className="text-xs text-destructive mt-1 truncate max-w-[120px]">{msg.error_message}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">
                      {formatDateBR(msg.sent_at ?? msg.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Configuracoes;
