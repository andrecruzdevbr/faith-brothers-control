import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/supabase.ts";
import { resolveEvolutionConfig } from "../_shared/evolution-config.ts";

function readEnv() {
  return {
    WHATSAPP_PROVIDER: Deno.env.get("WHATSAPP_PROVIDER"),
    WHATSAPP_SEND_ENABLED: Deno.env.get("WHATSAPP_SEND_ENABLED"),
    WHATSAPP_EVOLUTION_BASE_URL: Deno.env.get("WHATSAPP_EVOLUTION_BASE_URL"),
    WHATSAPP_EVOLUTION_PUBLIC_URL: Deno.env.get("WHATSAPP_EVOLUTION_PUBLIC_URL"),
    WHATSAPP_EVOLUTION_API_KEY: Deno.env.get("WHATSAPP_EVOLUTION_API_KEY"),
    WHATSAPP_EVOLUTION_INSTANCE: Deno.env.get("WHATSAPP_EVOLUTION_INSTANCE"),
    EVOLUTION_API_URL: Deno.env.get("EVOLUTION_API_URL"),
    EVOLUTION_API_KEY: Deno.env.get("EVOLUTION_API_KEY"),
    EVOLUTION_INSTANCE_NAME: Deno.env.get("EVOLUTION_INSTANCE_NAME"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    await requireAdmin(req.headers.get("Authorization") ?? "");
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "status");
    const pairNumber = String(body.number ?? "5531985010010").replace(/\D/g, "");

    const config = resolveEvolutionConfig(readEnv());
    const base = config.baseUrl.replace(/\/$/, "");
    const instance = config.instance;

    async function evo(path: string, init: RequestInit = {}) {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          apikey: config.apiKey,
          ...(init.headers ?? {}),
        },
      });
      const raw = await response.text();
      let data: unknown = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = { raw: raw.slice(0, 300) };
      }
      return { status: response.status, data };
    }

    if (action === "logout") {
      const result = await evo(`/instance/logout/${instance}`, { method: "DELETE" });
      return new Response(JSON.stringify({ action, instance, httpStatus: result.status, ok: result.status < 300 }), {
        headers,
      });
    }

    if (action === "connect") {
      const result = await evo(`/instance/connect/${instance}?number=${encodeURIComponent(pairNumber)}`, {
        method: "GET",
      });
      const data = (result.data ?? {}) as Record<string, unknown>;
      const pairingCode =
        (typeof data.pairingCode === "string" && data.pairingCode) ||
        (typeof data.code === "string" && data.code) ||
        null;
      const hasQr = Boolean(data.base64 || data.qrcode || data.qr);
      return new Response(
        JSON.stringify({
          action,
          instance,
          httpStatus: result.status,
          pairingCode,
          hasQr,
          hint: pairingCode
            ? "WhatsApp > Aparelhos conectados > Conectar com número de telefone > informar pairingCode"
            : hasQr
              ? "Escaneie o QR no painel Evolution da VPS (mesmo instance name)"
              : "Abra o painel Evolution na VPS e reconecte a instância FaithBrothersAcademia",
        }),
        { headers },
      );
    }

    const state = await evo(`/instance/connectionState/${instance}`);
    return new Response(
      JSON.stringify({ action: "status", instance, httpStatus: state.status, data: state.data }),
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
});
