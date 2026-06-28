import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getEnv } from "../_shared/env.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import { handleAsaasWebhookRequest } from "../_shared/asaas-webhook.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  const payload = await req.json().catch(() => ({}));
  const result = await handleAsaasWebhookRequest({
    accessToken: req.headers.get("asaas-access-token"),
    webhookToken: getEnv("ASAAS_WEBHOOK_TOKEN"),
    payload,
    supabase: createServiceClient(),
    queueWhatsAppFn: queueWhatsApp,
  });

  return new Response(JSON.stringify(result.body), { status: result.status, headers });
});
