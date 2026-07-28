import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { requireAdmin, createServiceClient } from "../_shared/supabase.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    await requireAdmin(authHeader);

    const { numero, mensagem } = await req.json();
    if (!numero || !mensagem) {
      return new Response(JSON.stringify({ error: "numero e mensagem são obrigatórios" }), { status: 400, headers });
    }

    const supabase = createServiceClient();
    const result = await queueWhatsApp({
      supabase,
      recipient: String(numero),
      body: String(mensagem),
      messageType: "general",
      sendImmediately: true,
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageId: result.messageId,
        number: numero,
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
