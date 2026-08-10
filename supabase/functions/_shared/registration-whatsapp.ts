import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { queueWhatsApp, type QueueWhatsAppResult } from "./whatsapp.ts";
import {
  buildAdminCreatedRegistrationApprovedMessage,
  buildRegistrationApprovedIdempotencyKey,
  buildRegistrationReceivedIdempotencyKey,
  buildRegistrationReceivedMessage,
  resolveRegistrationApprovedVariant,
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
  studentId?: string | null;
  fullName: string;
  whatsapp: string;
  queueWhatsAppFn?: typeof queueWhatsApp;
}): Promise<WhatsAppDispatchInfo> {
  const queueFn = params.queueWhatsAppFn ?? queueWhatsApp;
  const studentId = params.studentId ? String(params.studentId) : null;

  try {
    const queueResult: QueueWhatsAppResult = await queueFn({
      supabase: params.supabase,
      academyId: params.academyId,
      studentId,
      recipient: params.whatsapp,
      body: buildRegistrationReceivedMessage(params.fullName),
      messageType: "registration",
      idempotencyKey: studentId
        ? buildRegistrationReceivedIdempotencyKey(studentId)
        : undefined,
      sendImmediately: true,
    });
    return toWhatsAppDispatchInfo(queueResult);
  } catch (whatsappError) {
    logSafeError(
      "register-student whatsapp failed",
      {
        studentId,
        whatsapp: params.whatsapp,
        academyId: params.academyId,
      },
      whatsappError,
    );
    return { queued: false, reason: "whatsapp_queue_failed" };
  }
}

/** Admin-created student: single registration_approved (already cadastral-approved). */
export async function dispatchAdminCreatedRegistrationWhatsApp(params: {
  supabase: SupabaseClient;
  academyId: string;
  studentId: string;
  fullName: string;
  whatsapp: string;
  registrationAudience?: string | null;
  paymentReviewStatus?: string | null;
  pendingFamilyGroupId?: string | null;
  requestedPaymentMethod?: string | null;
  requestedTrainingDays?: number | null;
  queueWhatsAppFn?: typeof queueWhatsApp;
}): Promise<WhatsAppDispatchInfo> {
  const queueFn = params.queueWhatsAppFn ?? queueWhatsApp;
  const variant = resolveRegistrationApprovedVariant({
    registrationAudience: params.registrationAudience,
    paymentReviewStatus: params.paymentReviewStatus,
    pendingFamilyGroupId: params.pendingFamilyGroupId,
    requestedPaymentMethod: params.requestedPaymentMethod,
  });
  try {
    const queueResult: QueueWhatsAppResult = await queueFn({
      supabase: params.supabase,
      academyId: params.academyId,
      studentId: params.studentId,
      recipient: params.whatsapp,
      body: buildAdminCreatedRegistrationApprovedMessage(
        params.fullName,
        variant,
        params.requestedTrainingDays,
      ),
      messageType: "registration_approved",
      idempotencyKey: buildRegistrationApprovedIdempotencyKey(params.studentId),
      sendImmediately: true,
    });
    return toWhatsAppDispatchInfo(queueResult);
  } catch (whatsappError) {
    logSafeError(
      "register-student admin approval whatsapp failed",
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
