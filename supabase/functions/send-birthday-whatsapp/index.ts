import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getEnv } from "../_shared/env.ts";
import { runBirthdayWhatsAppJob } from "../_shared/birthday-whatsapp.ts";
import { sanitizeLogError } from "../_shared/sanitize-log.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const cronSecret = getEnv("BILLING_CRON_SECRET");
    if (req.headers.get("x-cron-secret") !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createServiceClient();
    const summary = await runBirthdayWhatsAppJob({ supabase });

    return new Response(JSON.stringify(summary), { headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: sanitizeLogError(error) }),
      { status: 500, headers },
    );
  }
});
