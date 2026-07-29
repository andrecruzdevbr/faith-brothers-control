import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { normalizeWhatsapp } from "../_shared/phone.ts";
import {
  findUserByWhatsappEmail,
  handleRequestOtp,
  hashOtpCode,
} from "../_shared/password-reset.ts";

const MAX_VERIFY_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const action = body.action as string;

    if (action === "request_otp") {
      const result = await handleRequestOtp({
        supabase,
        whatsappRaw: String(body.whatsapp ?? ""),
      });
      return new Response(JSON.stringify(result.body), { status: result.status, headers });
    }

    if (action === "verify_otp") {
      const whatsapp = normalizeWhatsapp(body.whatsapp ?? "");
      const code = String(body.code ?? "");
      const newPassword = String(body.new_password ?? "");

      if (!code || newPassword.length < 8) {
        return new Response(JSON.stringify({ error: "Senha deve ter no mínimo 8 caracteres" }), {
          status: 400,
          headers,
        });
      }

      const { data: tokenRow } = await supabase
        .from("otp_tokens")
        .select("*")
        .eq("whatsapp", whatsapp)
        .eq("used", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tokenRow || new Date(tokenRow.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "Código inválido ou expirado" }), {
          status: 400,
          headers,
        });
      }

      if ((tokenRow.attempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
        return new Response(JSON.stringify({ error: "Muitas tentativas inválidas" }), {
          status: 429,
          headers,
        });
      }

      if (tokenRow.code_hash !== (await hashOtpCode(code))) {
        await supabase
          .from("otp_tokens")
          .update({ attempts: (tokenRow.attempts ?? 0) + 1 })
          .eq("id", tokenRow.id);
        return new Response(JSON.stringify({ error: "Código inválido" }), { status: 400, headers });
      }

      const user = await findUserByWhatsappEmail(supabase, whatsapp);
      if (!user) {
        return new Response(JSON.stringify({ error: "Usuário não encontrado" }), {
          status: 404,
          headers,
        });
      }

      const { error } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }

      await supabase.from("otp_tokens").update({ used: true }).eq("id", tokenRow.id);

      return new Response(JSON.stringify({ success: true, message: "Senha alterada com sucesso" }), {
        headers,
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), { status: 400, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Limite") || message.includes("tentativas") ? 429 : 500;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
});
