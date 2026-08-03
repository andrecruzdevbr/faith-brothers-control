import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/supabase.ts";
import {
  buildEvolutionConnectionStateUrl,
  isEvolutionConnected,
  resolveEvolutionConfig,
} from "../_shared/evolution-config.ts";

function readDenoEnvMap(): Record<string, string | undefined> {
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
    const authHeader = req.headers.get("Authorization") ?? "";
    await requireAdmin(authHeader);

    const config = resolveEvolutionConfig(readDenoEnvMap());
    const url = buildEvolutionConnectionStateUrl(config.baseUrl, config.instance);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: config.apiKey,
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Evolution connectionState failed [${response.status}]`,
          provider: config.provider,
          sendEnabled: config.sendEnabled,
          instance: config.instance,
        }),
        { status: 502, headers },
      );
    }

    const state =
      typeof data?.instance?.state === "string"
        ? data.instance.state
        : typeof data?.state === "string"
          ? data.state
          : null;

    let ownerDigits: string | null = null;
    let instancesSummary: Array<{ name: string; state: string | null; ownerDigits: string | null }> = [];

    try {
      const fetchUrl = `${config.baseUrl.replace(/\/$/, "")}/instance/fetchInstances`;
      const fetchResp = await fetch(fetchUrl, {
        method: "GET",
        headers: { apikey: config.apiKey },
      });
      const fetchData = await fetchResp.json().catch(() => null);
      const list = Array.isArray(fetchData)
        ? fetchData
        : Array.isArray(fetchData?.instance)
          ? fetchData.instance
          : Array.isArray(fetchData?.data)
            ? fetchData.data
            : [];

      for (const item of list) {
        const name = String(item?.instanceName ?? item?.name ?? item?.instance?.instanceName ?? "");
        const st = String(item?.status ?? item?.connectionStatus ?? item?.instance?.state ?? item?.state ?? "") || null;
        const ownerRaw = String(
          item?.ownerJid ??
            item?.owner ??
            item?.instance?.ownerJid ??
            item?.instance?.owner ??
            item?.number ??
            "",
        );
        const digits = ownerRaw ? ownerRaw.replace(/\D/g, "").replace(/@.*/, "") : null;
        if (name) {
          instancesSummary.push({ name, state: st, ownerDigits: digits });
        }
        if (name === config.instance && digits) ownerDigits = digits;
      }
    } catch {
      // optional enrichment
    }

    return new Response(
      JSON.stringify({
        provider: config.provider,
        sendEnabled: config.sendEnabled,
        instance: config.instance,
        publicUrl: config.publicUrl,
        baseUrlHost: (() => {
          try {
            return new URL(config.baseUrl).host;
          } catch {
            return null;
          }
        })(),
        state,
        connected: isEvolutionConnected(state),
        ownerDigits,
        instances: instancesSummary.slice(0, 10),
      }),
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
});
