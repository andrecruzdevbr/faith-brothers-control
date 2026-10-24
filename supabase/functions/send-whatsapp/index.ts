import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { requireAdmin, createServiceClient } from "../_shared/supabase.ts";
import { parseAdminWhatsAppSendRequest } from "../_shared/phone.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    await requireAdmin(authHeader);

    const body = await req.json().catch(() => ({}));
    const parsed = parseAdminWhatsAppSendRequest(body ?? {});
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers });
    }

    const supabase = createServiceClient();
    const result = await queueWhatsApp({
      supabase,
      recipient: parsed.recipient,
      body: parsed.body,
      messageType: "general",
      sendImmediately: true,
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageId: result.messageId,
        number: parsed.recipient,
        sent: result.sent,
        skipped: result.skipped ?? false,
        reason: result.reason,
      }),
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 502;
    return new Response(JSON.stringify({ success: false, error: message }), { status, headers });
  }
});
