import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getEnv, getEnvBoolean } from "../_shared/env.ts";
import { processPendingMessages } from "../_shared/whatsapp.ts";

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

    const supabase = createServiceClient();
    const processed = await processPendingMessages(supabase, 50);

    return new Response(JSON.stringify({ success: true, processed }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
