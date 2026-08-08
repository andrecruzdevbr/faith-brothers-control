import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getEnv, getEnvBoolean } from "../_shared/env.ts";
import { processPendingMessages, processWhatsAppMessageById } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const cronSecret = getEnv("BILLING_CRON_SECRET");
    if (req.headers.get("x-cron-secret") !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const sendEnabled = getEnvBoolean("WHATSAPP_SEND_ENABLED", false);
    if (!sendEnabled) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          skipped: true,
          reason: "WHATSAPP_SEND_ENABLED=false",
        }),
        { headers },
      );
    }

    let messageId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = (await req.json()) as { messageId?: string };
        if (typeof body.messageId === "string" && body.messageId.trim()) {
          messageId = body.messageId.trim();
        }
      } catch {
        messageId = null;
      }
    }

    const supabase = createServiceClient();

    if (messageId) {
      const result = await processWhatsAppMessageById(supabase, messageId);
      return new Response(
        JSON.stringify({
          success: result.status === "sent" || result.error === "already_sent",
          mode: "single",
          messageId,
          ...result,
        }),
        { headers },
      );
    }

    const processed = await processPendingMessages(supabase, 50);
    return new Response(JSON.stringify({ success: true, mode: "batch", processed }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
