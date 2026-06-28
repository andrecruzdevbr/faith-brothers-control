import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { normalizeWhatsapp, toSyntheticEmail } from "../_shared/phone.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import { getEnvOptional } from "../_shared/env.ts";

const MAX_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const OTP_EXPIRY_MINUTES = 10;

async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(supabase: ReturnType<typeof createServiceClient>, whatsapp: string): Promise<void> {
  const now = new Date();
  const { data: row } = await supabase
    .from("otp_rate_limits")
    .select("*")
    .eq("whatsapp", whatsapp)
    .maybeSingle();

  if (row?.blocked_until && new Date(row.blocked_until) > now) {
    throw new Error("Muitas tentativas. Tente novamente mais tarde.");
  }

  const windowStart = row?.window_start ? new Date(row.window_start) : now;
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const inWindow = windowStart > hourAgo;
  const count = inWindow ? (row?.request_count ?? 0) + 1 : 1;

  if (count > MAX_REQUESTS_PER_HOUR) {
    await supabase.from("otp_rate_limits").upsert({
      whatsapp,
      request_count: count,
      window_start: inWindow ? windowStart.toISOString() : now.toISOString(),
      blocked_until: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    });
    throw new Error("Limite de solicitações atingido. Tente em 1 hora.");
  }

  await supabase.from("otp_rate_limits").upsert({
    whatsapp,
    request_count: count,
    window_start: inWindow ? windowStart.toISOString() : now.toISOString(),
    blocked_until: null,
  });
}

async function findUserByWhatsapp(supabase: ReturnType<typeof createServiceClient>, whatsapp: string) {
  const email = toSyntheticEmail(whatsapp);
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error("Erro ao buscar usuário");
  return data.users.find((u) => u.email === email) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const action = body.action as string;

    if (action === "request_otp") {
      const whatsapp = normalizeWhatsapp(body.whatsapp ?? "");
      if (!/^\d{10,11}$/.test(whatsapp)) {
        return new Response(JSON.stringify({ error: "WhatsApp inválido" }), { status: 400, headers });
      }

      await checkRateLimit(supabase, whatsapp);

      const user = await findUserByWhatsapp(supabase, whatsapp);
      if (!user) {
        return new Response(JSON.stringify({ error: "WhatsApp não cadastrado" }), { status: 404, headers });
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

      await supabase.from("otp_tokens").delete().eq("whatsapp", whatsapp);
      await supabase.from("otp_tokens").insert({
        whatsapp,
        code_hash: await hashCode(code),
        expires_at: expiresAt,
      });

      const message = `Fala irmão! Seu código é: *${code}*\n\n🔒 Válido por ${OTP_EXPIRY_MINUTES} minutos.\n\nFaith Brothers BJJ 🥋`;

      try {
        await queueWhatsApp({
          supabase,
          recipient: whatsapp,
          body: message,
          messageType: "otp",
          sendImmediately: true,
        });
      } catch (e) {
        console.error("WhatsApp OTP send failed:", e);
        return new Response(JSON.stringify({ error: "Falha ao enviar código via WhatsApp" }), { status: 502, headers });
      }

      return new Response(JSON.stringify({ success: true, message: "Código enviado via WhatsApp" }), { headers });
    }

    if (action === "verify_otp") {
      const whatsapp = normalizeWhatsapp(body.whatsapp ?? "");
      const code = String(body.code ?? "");
      const newPassword = String(body.new_password ?? "");

      if (!code || newPassword.length < 8) {
        return new Response(JSON.stringify({ error: "Senha deve ter no mínimo 8 caracteres" }), { status: 400, headers });
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
        return new Response(JSON.stringify({ error: "Código inválido ou expirado" }), { status: 400, headers });
      }

      if ((tokenRow.attempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
        return new Response(JSON.stringify({ error: "Muitas tentativas inválidas" }), { status: 429, headers });
      }

      if (tokenRow.code_hash !== (await hashCode(code))) {
        await supabase
          .from("otp_tokens")
          .update({ attempts: (tokenRow.attempts ?? 0) + 1 })
          .eq("id", tokenRow.id);
        return new Response(JSON.stringify({ error: "Código inválido" }), { status: 400, headers });
      }

      const user = await findUserByWhatsapp(supabase, whatsapp);
      if (!user) {
        return new Response(JSON.stringify({ error: "Usuário não encontrado" }), { status: 404, headers });
      }

      const { error } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }

      await supabase.from("otp_tokens").update({ used: true }).eq("id", tokenRow.id);

      return new Response(JSON.stringify({ success: true, message: "Senha alterada com sucesso" }), { headers });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), { status: 400, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Limite") || message.includes("tentativas") ? 429 : 500;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  }
});
