import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEnv } from "./env.ts";
import { toEvolutionNumber } from "./phone.ts";

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

export async function sendViaEvolution(recipient: string, text: string): Promise<{ ok: boolean; externalId?: string; error?: string }> {
  const baseUrl = getEnv("EVOLUTION_API_URL").replace(/\/$/, "");
  const apiKey = getEnv("EVOLUTION_API_KEY");
  const instance = getEnv("EVOLUTION_INSTANCE_NAME");

  const response = await fetch(`${baseUrl}/message/sendText/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: toEvolutionNumber(recipient), text }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: `Evolution API [${response.status}]: ${JSON.stringify(data)}` };
  }

  const externalId = data?.key?.id ?? data?.messageId ?? undefined;
  return { ok: true, externalId };
}

export async function queueWhatsApp(params: QueueWhatsAppParams): Promise<{ messageId: string; sent: boolean }> {
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
