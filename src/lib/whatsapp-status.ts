import { supabase } from "@/integrations/supabase/client";

export const EXPECTED_EVOLUTION_HOST = "2.24.108.128";
export const WHATSAPP_STATUS_TIMEOUT_MS = 15_000;
export const WHATSAPP_STATUS_FUNCTION = "whatsapp-status";

export type WhatsAppConnectionKind = "connected" | "disconnected" | "error" | "checking";

export type WhatsAppStatusFunctionResponse = {
  connected?: boolean;
  state?: string | null;
  instance?: string | null;
  baseUrlHost?: string | null;
  publicUrl?: string | null;
  sendEnabled?: boolean;
  error?: string | null;
  provider?: string;
};

export type WhatsAppStatusView = {
  kind: WhatsAppConnectionKind;
  label: string;
  instance: string | null;
  server: string | null;
  unexpectedHost: boolean;
  hostWarning: string | null;
  details: string | null;
};

export const WHATSAPP_STATUS_CHECKING: WhatsAppStatusView = {
  kind: "checking",
  label: "Verificando",
  instance: null,
  server: null,
  unexpectedHost: false,
  hostWarning: null,
  details: "Consultando a Evolution API…",
};

const UNEXPECTED_HOST_WARNING =
  "O servidor consultado não é a VPS de Production esperada. Não altere a configuração do servidor sem autorização.";

export function sanitizeWhatsAppStatusText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/apikey\s*[=:]\s*\S+/gi, "apikey=[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .trim();
}

export function hostnameFromServer(server: string | null | undefined): string | null {
  if (!server) return null;
  const trimmed = server.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`http://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return trimmed.split(":")[0]?.toLowerCase() || null;
  }
}

export function isExpectedEvolutionHost(server: string | null | undefined): boolean {
  return hostnameFromServer(server) === EXPECTED_EVOLUTION_HOST;
}

function safeInstanceName(instance: string | null | undefined): string | null {
  const value = (instance ?? "").trim();
  if (!value || value.length > 80) return null;
  if (/apikey|token|secret|bearer/i.test(value)) return null;
  if (/\s/.test(value)) return null;
  return value;
}

function safeServerHost(host: string | null | undefined): string | null {
  const value = (host ?? "").trim();
  if (!value || value.length > 120) return null;
  if (/apikey|token|secret|bearer/i.test(value)) return null;
  return value;
}

export function interpretWhatsAppStatusError(error: unknown): WhatsAppStatusView {
  const raw =
    error instanceof Error
      ? error.name === "AbortError"
        ? "Tempo esgotado ao consultar o servidor."
        : error.message
      : "Erro desconhecido";
  const message = sanitizeWhatsAppStatusText(raw);
  const lower = message.toLowerCase();

  let details = message;
  if (lower.includes("não autenticado") || lower.includes("unauthorized")) {
    details = "Faça login como administrador para verificar a conexão.";
  } else if (lower.includes("forbidden")) {
    details = "Apenas administradores podem verificar a conexão.";
  } else if (lower.includes("tempo esgotado") || lower.includes("timeout")) {
    details = "A consulta excedeu o tempo limite.";
  } else if (lower.includes("failed to fetch") || lower.includes("network")) {
    details = "Não foi possível alcançar o servidor.";
  } else if (lower.includes("connectionstate failed")) {
    details = "A Evolution API falhou ao consultar a instância.";
  }

  return {
    kind: "error",
    label: "Erro",
    instance: null,
    server: null,
    unexpectedHost: false,
    hostWarning: null,
    details,
  };
}

export function interpretWhatsAppStatusResponse(
  data: WhatsAppStatusFunctionResponse,
): WhatsAppStatusView {
  if (data.error && data.connected !== true) {
    return interpretWhatsAppStatusError(new Error(data.error));
  }

  const server = safeServerHost(data.baseUrlHost);
  const unexpectedHost = !isExpectedEvolutionHost(server);
  const connected = data.connected === true;
  const kind: WhatsAppConnectionKind = connected ? "connected" : "disconnected";

  return {
    kind,
    label: connected ? "Conectado" : "Desconectado",
    instance: safeInstanceName(data.instance),
    server,
    unexpectedHost,
    hostWarning: unexpectedHost ? UNEXPECTED_HOST_WARNING : null,
    details: connected
      ? "Sessão WhatsApp aberta na Evolution."
      : data.state
        ? `Sessão ${sanitizeWhatsAppStatusText(String(data.state))}.`
        : "A instância respondeu, mas a sessão não está aberta.",
  };
}

export async function fetchWhatsAppStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppStatusView> {
  const publishableKey = (
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  ) as string | undefined;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const baseUrl = import.meta.env.VITE_SUPABASE_URL ?? `https://${projectId}.supabase.co`;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return interpretWhatsAppStatusError(new Error("Não autenticado"));
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  headers.Authorization = `Bearer ${session.access_token}`;
  if (publishableKey) headers.apikey = publishableKey;

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), WHATSAPP_STATUS_TIMEOUT_MS);

  try {
    const res = await fetchImpl(`${baseUrl}/functions/v1/${WHATSAPP_STATUS_FUNCTION}`, {
      method: "POST",
      headers,
      body: "{}",
      signal: controller.signal,
    });

    let payload: WhatsAppStatusFunctionResponse = {};
    try {
      payload = (await res.json()) as WhatsAppStatusFunctionResponse;
    } catch {
      if (!res.ok) {
        return interpretWhatsAppStatusError(new Error(`Erro na requisição (${res.status})`));
      }
      return interpretWhatsAppStatusError(new Error("Resposta inválida do servidor."));
    }

    if (!res.ok) {
      return interpretWhatsAppStatusError(
        new Error(payload.error || payload.state || `Erro na requisição (${res.status})`),
      );
    }

    return interpretWhatsAppStatusResponse(payload);
  } catch (error) {
    return interpretWhatsAppStatusError(error);
  } finally {
    globalThis.clearTimeout(timer);
  }
}
