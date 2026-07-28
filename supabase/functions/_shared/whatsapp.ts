import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { toEvolutionNumber } from "./phone.ts";
import {
  buildEvolutionSendTextUrl,
  resolveEvolutionConfig,
  type EvolutionConfig,
} from "./evolution-config.ts";

export type WhatsAppMessageType =
  | "general"
  | "billing"
  | "attendance"
  | "otp"
  | "payment_confirmation";

export interface QueueWhatsAppParams {
  supabase: SupabaseClient;
  recipient: string;
  body: string;
  messageType: WhatsAppMessageType;
  academyId?: string | null;
  studentId?: string | null;
  billingId?: string | null;
  sendImmediately?: boolean;
}

export type SendViaEvolutionResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  externalId?: string;
  error?: string;
};

export type QueueWhatsAppResult = {
  messageId: string;
  sent: boolean;
  skipped?: boolean;
  reason?: string;
};

function readDenoEnvMap(): Record<string, string | undefined> {
  return {
    WHATSAPP_PROVIDER: Deno.env.get("WHATSAPP_PROVIDER"),
    WHATSAPP_SEND_ENABLED: Deno.env.get("WHATSAPP_SEND_ENABLED"),
    WHATSAPP_EVOLUTION_BASE_URL: Deno.env.get("WHATSAPP_EVOLUTION_BASE_URL"),
    WHATSAPP_EVOLUTION_PUBLIC_URL: Deno.env.get("WHATSAPP_EVOLUTION_PUBLIC_URL"),
    WHATSAPP_EVOLUTION_API_KEY: Deno.env.get("WHATSAPP_EVOLUTION_API_KEY"),
    WHATSAPP_EVOLUTION_INSTANCE: Deno.env.get("WHATSAPP_EVOLUTION_INSTANCE"),
    EVOLUTION_API_URL: Deno.env.get("EVOLUTION_API_URL"),
    EVOLUTION_API_KEY: Deno.env.get("EVOLUTION_API_KEY"),
    EVOLUTION_INSTANCE_NAME: Deno.env.get("EVOLUTION_INSTANCE_NAME"),
  };
}

export function getWhatsAppEvolutionConfig(): EvolutionConfig {
  return resolveEvolutionConfig(readDenoEnvMap());
}

export async function sendViaEvolution(
  recipient: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendViaEvolutionResult> {
  const config = getWhatsAppEvolutionConfig();

  if (!config.sendEnabled) {
    return {
      ok: true,
      skipped: true,
      reason: "WHATSAPP_SEND_ENABLED=false",
    };
  }

  const url = buildEvolutionSendTextUrl(config.baseUrl, config.instance);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
    },
    body: JSON.stringify({
      number: toEvolutionNumber(recipient),
      text,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: `Evolution API [${response.status}]: send failed`,
    };
  }

  const externalId = data?.key?.id ?? data?.messageId ?? undefined;
  return { ok: true, externalId };
}

export async function queueWhatsApp(params: QueueWhatsAppParams): Promise<QueueWhatsAppResult> {
  const { data: row, error } = await params.supabase
    .from("whatsapp_messages")
    .insert({
      academy_id: params.academyId ?? null,
      student_id: params.studentId ?? null,
      billing_id: params.billingId ?? null,
      recipient: toEvolutionNumber(params.recipient),
      message_type: params.messageType,
      body: params.body,
      status: params.sendImmediately ? "processing" : "pending",
    })
    .select("id")
    .single();

  if (error || !row) throw new Error(`Failed to queue WhatsApp: ${error?.message ?? "unknown"}`);

  if (params.sendImmediately !== false) {
    const result = await sendViaEvolution(params.recipient, params.body);

    if (result.skipped) {
      await params.supabase
        .from("whatsapp_messages")
        .update({
          status: "pending",
          attempts: 0,
          error_message: result.reason ?? "WHATSAPP_SEND_ENABLED=false",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      return {
        messageId: row.id,
        sent: false,
        skipped: true,
        reason: result.reason,
      };
    }

    await params.supabase
      .from("whatsapp_messages")
      .update({
        status: result.ok ? "sent" : "failed",
        attempts: 1,
        external_id: result.externalId ?? null,
        error_message: result.error ?? null,
        sent_at: result.ok ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (!result.ok) throw new Error(result.error ?? "WhatsApp send failed");
    return { messageId: row.id, sent: true };
  }

  return { messageId: row.id, sent: false };
}

export async function processPendingMessages(supabase: SupabaseClient, limit = 20): Promise<number> {
  const { data: pending } = await supabase
    .from("whatsapp_messages")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", 3)
    .order("created_at", { ascending: true })
    .limit(limit);

  let processed = 0;
  for (const msg of pending ?? []) {
    await supabase.from("whatsapp_messages").update({ status: "processing" }).eq("id", msg.id);
    const result = await sendViaEvolution(msg.recipient, msg.body);

    if (result.skipped) {
      await supabase
        .from("whatsapp_messages")
        .update({
          status: "pending",
          error_message: result.reason ?? "WHATSAPP_SEND_ENABLED=false",
          updated_at: new Date().toISOString(),
        })
        .eq("id", msg.id);
      continue;
    }

    await supabase
      .from("whatsapp_messages")
      .update({
        status: result.ok ? "sent" : "failed",
        attempts: (msg.attempts ?? 0) + 1,
        external_id: result.externalId ?? null,
        error_message: result.error ?? null,
        sent_at: result.ok ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", msg.id);
    processed++;
  }
  return processed;
}
