import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { normalizeWhatsapp, toSyntheticEmail } from "./phone.ts";
import { queueWhatsApp } from "./whatsapp.ts";
import {
  buildPasswordResetOtpMessage,
  toWhatsAppDispatchInfo,
  type WhatsAppDispatchInfo,
} from "./whatsapp-messages.ts";
import { logSafeError } from "./sanitize-log.ts";

const MAX_REQUESTS_PER_HOUR = 5;
export const OTP_EXPIRY_MINUTES = 10;

export const PASSWORD_RESET_GENERIC_MESSAGE =
  "Se o WhatsApp estiver cadastrado, enviaremos um código de recuperação.";

export async function hashOtpCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(supabase: SupabaseClient, whatsapp: string): Promise<void> {
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

export async function findUserByWhatsappEmail(supabase: SupabaseClient, whatsapp: string) {
  const email = toSyntheticEmail(whatsapp);
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error("Erro ao buscar usuário");
  return data.users.find((u) => u.email === email) ?? null;
}

export type RequestOtpResult = {
  status: number;
  body: Record<string, unknown>;
};

export type QueueWhatsAppFn = typeof queueWhatsApp;

/**
 * Core OTP request flow. Never includes the OTP code in the response body.
 */
export async function handleRequestOtp(params: {
  supabase: SupabaseClient;
  whatsappRaw: string;
  queueWhatsAppFn?: QueueWhatsAppFn;
  createOtpCode?: () => string;
}): Promise<RequestOtpResult> {
  const queueFn = params.queueWhatsAppFn ?? queueWhatsApp;
  const createOtpCode =
    params.createOtpCode ??
    (() => String(Math.floor(100000 + Math.random() * 900000)));

  const whatsapp = normalizeWhatsapp(params.whatsappRaw ?? "");
  if (!/^\d{10,11}$/.test(whatsapp)) {
    return { status: 400, body: { error: "WhatsApp inválido" } };
  }

  await checkRateLimit(params.supabase, whatsapp);

  const user = await findUserByWhatsappEmail(params.supabase, whatsapp);
  if (!user) {
    return {
      status: 200,
      body: {
        success: true,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
        whatsapp: { queued: false } as WhatsAppDispatchInfo,
      },
    };
  }

  const code = createOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await params.supabase.from("otp_tokens").delete().eq("whatsapp", whatsapp);
  await params.supabase.from("otp_tokens").insert({
    whatsapp,
    code_hash: await hashOtpCode(code),
    expires_at: expiresAt,
  });

  const message = buildPasswordResetOtpMessage(code, OTP_EXPIRY_MINUTES);
  let whatsappInfo: WhatsAppDispatchInfo = { queued: false };

  try {
    const queueResult = await queueFn({
      supabase: params.supabase,
      recipient: whatsapp,
      body: message,
      messageType: "otp",
      sendImmediately: true,
    });
    whatsappInfo = toWhatsAppDispatchInfo(queueResult);
  } catch (error) {
    logSafeError("reset-password whatsapp OTP failed", { whatsapp }, error);
    return {
      status: 502,
      body: {
        error: "Falha ao enviar código via WhatsApp",
        whatsapp: { queued: false, reason: "whatsapp_send_failed" },
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      message: PASSWORD_RESET_GENERIC_MESSAGE,
      whatsapp: whatsappInfo,
    },
  };
}
