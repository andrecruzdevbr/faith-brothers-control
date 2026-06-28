import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient, requireAuth } from "../_shared/supabase.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers });
    }

    const { userId, supabase } = await requireAuth(authHeader);
    const { token } = await req.json();

    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "Token inválido" }), { status: 400, headers });
    }

    const { data, error } = await supabase.rpc("record_attendance_by_token", { _token: token });

    if (error) {
      const msg = error.message;
      const status = msg.includes("já registrada") ? 409 : 400;
      return new Response(JSON.stringify({ error: msg, already_checked_in: msg.includes("já registrada") }), { status, headers });
    }

    try {
      const serviceClient = createServiceClient();
      const { data: profile } = await serviceClient.from("profiles").select("whatsapp").eq("user_id", userId).maybeSingle();
      if (profile?.whatsapp) {
        await queueWhatsApp({
          supabase: serviceClient,
          recipient: profile.whatsapp,
          body: "Fala irmão! Presença confirmada hoje 💪🥋\n\nTmj! Oss 👊🏽",
          messageType: "attendance",
          sendImmediately: true,
        });
      }
    } catch {
      // best effort
    }

    return new Response(JSON.stringify({ success: true, message: "Presença registrada com sucesso!", data }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
});
