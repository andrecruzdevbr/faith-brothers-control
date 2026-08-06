import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { queueWhatsApp, type QueueWhatsAppResult } from "./whatsapp.ts";
import {
  buildRegistrationReceivedMessage,
  toWhatsAppDispatchInfo,
  type WhatsAppDispatchInfo,
} from "./whatsapp-messages.ts";
import { logSafeError } from "./sanitize-log.ts";

/**
 * After a successful student registration, queue/send confirmation WhatsApp.
 * Failures are swallowed into whatsapp info — registration remains successful.
 */
export async function dispatchRegistrationWhatsApp(params: {
  supabase: SupabaseClient;
  academyId: string;
  studentId: string;
  fullName: string;
  whatsapp: string;
  queueWhatsAppFn?: typeof queueWhatsApp;
}): Promise<WhatsAppDispatchInfo> {
  const queueFn = params.queueWhatsAppFn ?? queueWhatsApp;

  try {
    const queueResult: QueueWhatsAppResult = await queueFn({
      supabase: params.supabase,
      academyId: params.academyId,
      studentId: params.studentId,
      recipient: params.whatsapp,
      body: buildRegistrationReceivedMessage(params.fullName),
      messageType: "registration",
      sendImmediately: true,
    });
    return toWhatsAppDispatchInfo(queueResult);
  } catch (whatsappError) {
    logSafeError(
      "register-student whatsapp failed",
      {
        studentId: params.studentId,
        whatsapp: params.whatsapp,
        academyId: params.academyId,
      },
      whatsappError,
    );
    return { queued: false, reason: "whatsapp_queue_failed" };
  }
}
