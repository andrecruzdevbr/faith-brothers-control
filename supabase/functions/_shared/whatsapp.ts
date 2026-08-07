import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { toEvolutionNumber } from "./phone.ts";
import {
  buildEvolutionSendTextUrl,
  resolveEvolutionConfig,
  type EvolutionConfig,
} from "./evolution-config.ts";
import { formatEvolutionApiError } from "./evolution-error.ts";

export type WhatsAppMessageType =
  | "general"
  | "registration"
  | "billing"
  | "billing_overdue"
  | "attendance"
  | "otp"
  | "payment_confirmation"
  | "birthday"
  | "contract_approved";

const EVOLUTION_FETCH_TIMEOUT_MS = 15_000;
const STUCK_PROCESSING_MS = 2 * 60_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = EVOLUTION_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Evolution API timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface QueueWhatsAppParams {
  supabase: SupabaseClient;
  recipient: string;
  body: string;
  messageType: WhatsAppMessageType;
  academyId?: string | null;
  studentId?: string | null;
  billingId?: string | null;
  /** Stable key: messageType + contract + event — prevents duplicate queue/send */
  idempotencyKey?: string | null;
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
  const number = toEvolutionNumber(recipient);
  const payloads: Record<string, unknown>[] = [
    { number, text },
    { number, textMessage: { text } },
    {
      number,
      options: { delay: 1200, presence: "composing", linkPreview: false },
      textMessage: { text },
    },
  ];

  let lastError = "send failed";
  try {
    for (const body of payloads) {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: config.apiKey,
          },
          body: JSON.stringify(body),
        },
        fetchImpl,
      );

      const data = await response.json().catch(() => null);
      if (response.ok) {
        const externalId = data?.key?.id ?? data?.messageId ?? undefined;
        return { ok: true, externalId };
      }

      lastError = formatEvolutionApiError({
        httpStatus: response.status,
        instance: config.instance,
        number,
        body: data,
      });

      // Only fall through payload variants on 400; other statuses abort.
      if (response.status !== 400) {
        return { ok: false, error: lastError };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "send failed";
    return { ok: false, error: message.slice(0, 200) };
  }

  return { ok: false, error: lastError };
}

export async function queueWhatsApp(params: QueueWhatsAppParams): Promise<QueueWhatsAppResult> {
  if (params.idempotencyKey) {
    const { data: byKey } = await params.supabase
      .from("whatsapp_messages")
      .select("id, status")
      .eq("idempotency_key", params.idempotencyKey)
      .maybeSingle();
    if (byKey) {
      return {
        messageId: byKey.id,
        sent: byKey.status === "sent",
        skipped: true,
        reason: byKey.status === "sent" ? "already_sent" : "already_queued",
      };
    }
  }

  // Idempotency: one active/sent registration message per student.
  if (params.studentId && params.messageType === "registration") {
    const { data: existing } = await params.supabase
      .from("whatsapp_messages")
      .select("id, status, external_id")
      .eq("student_id", params.studentId)
      .eq("message_type", "registration")
      .in("status", ["pending", "processing", "sent"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return {
        messageId: existing.id,
        sent: existing.status === "sent",
        skipped: existing.status !== "sent",
        reason: existing.status === "sent" ? "already_sent" : "already_queued",
      };
    }
  }

  const { data: row, error } = await params.supabase
    .from("whatsapp_messages")
    .insert({
      academy_id: params.academyId ?? null,
      student_id: params.studentId ?? null,
      billing_id: params.billingId ?? null,
      recipient: toEvolutionNumber(params.recipient),
      message_type: params.messageType,
      body: params.body,
      idempotency_key: params.idempotencyKey ?? null,
      status: params.sendImmediately ? "processing" : "pending",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !row) {
    // Concurrent insert with same idempotency key
    if (params.idempotencyKey && error?.message?.toLowerCase().includes("duplicate")) {
      const { data: again } = await params.supabase
        .from("whatsapp_messages")
        .select("id, status")
        .eq("idempotency_key", params.idempotencyKey)
        .maybeSingle();
      if (again) {
        return {
          messageId: again.id,
          sent: again.status === "sent",
          skipped: true,
          reason: "already_queued",
        };
      }
    }
    throw new Error(`Failed to queue WhatsApp: ${error?.message ?? "unknown"}`);
  }

  if (params.sendImmediately !== false) {
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp send failed";
      await params.supabase
        .from("whatsapp_messages")
        .update({
          status: "failed",
          attempts: 1,
          error_message: message.slice(0, 300),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      throw error;
    }
  }

  return { messageId: row.id, sent: false };
}

export async function processWhatsAppMessageById(
  supabase: SupabaseClient,
  messageId: string,
): Promise<{ processed: boolean; status: string; externalId?: string | null; error?: string }> {
  const { data: msg, error } = await supabase
    .from("whatsapp_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!msg) throw new Error(`WhatsApp message not found: ${messageId}`);
  if (msg.status === "sent") {
    return {
      processed: false,
      status: "sent",
      externalId: msg.external_id ?? null,
      error: "already_sent",
    };
  }

  await supabase
    .from("whatsapp_messages")
    .update({
      status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId);

  try {
    const result = await sendViaEvolution(msg.recipient, msg.body);

    if (result.skipped) {
      await supabase
        .from("whatsapp_messages")
        .update({
          status: "pending",
          error_message: result.reason ?? "WHATSAPP_SEND_ENABLED=false",
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      return { processed: false, status: "pending", error: result.reason };
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
      .eq("id", messageId);

    return {
      processed: true,
      status: result.ok ? "sent" : "failed",
      externalId: result.externalId ?? null,
      error: result.error,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhatsApp send failed";
    await supabase
      .from("whatsapp_messages")
      .update({
        status: "failed",
        attempts: (msg.attempts ?? 0) + 1,
        error_message: message.slice(0, 300),
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);
    return { processed: true, status: "failed", error: message };
  }
}

export async function processPendingMessages(supabase: SupabaseClient, limit = 20): Promise<number> {
  const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MS).toISOString();

  // Reclaim messages stuck in processing (Edge timeout / unreachable Evolution).
  await supabase
    .from("whatsapp_messages")
    .update({
      status: "pending",
      error_message: "reclaimed_stuck_processing",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("created_at", stuckBefore);

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
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp send failed";
      await supabase
        .from("whatsapp_messages")
        .update({
          status: "failed",
          attempts: (msg.attempts ?? 0) + 1,
          error_message: message.slice(0, 300),
          updated_at: new Date().toISOString(),
        })
        .eq("id", msg.id);
      processed++;
    }
  }
  return processed;
}
