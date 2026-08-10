import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import {
  buildRegistrationApprovedIdempotencyKey,
  buildRegistrationApprovedMessage,
  resolveRegistrationApprovedVariant,
} from "../_shared/whatsapp-messages.ts";
import { logSafeError, sanitizeLogError } from "../_shared/sanitize-log.ts";

type Body = {
  student_id?: string;
  event?: "approved" | "veteran_period_request";
  send_immediately?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers });
    }

    const userClient = createUserClient(authHeader);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers });
    }

    const body = (await req.json()) as Body;
    const studentId = String(body.student_id ?? "").trim();
    // veteran_period_request is treated as the same cadastral approval message (one WA).
    const event = "approved";
    void body.event;
    if (!studentId) {
      return new Response(JSON.stringify({ error: "student_id obrigatório" }), { status: 400, headers });
    }

    const supabase = createServiceClient();
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select(
        "id, academy_id, full_name, whatsapp, registration_audience, requested_training_days, payment_review_status, pending_family_group_id, requested_payment_method",
      )
      .eq("id", studentId)
      .maybeSingle();

    if (studentError) throw new Error(studentError.message);
    if (!student?.whatsapp) {
      return new Response(JSON.stringify({ error: "Aluno sem WhatsApp" }), { status: 400, headers });
    }

    const { data: isStaff, error: staffError } = await userClient.rpc("is_staff_of_academy", {
      _academy_id: student.academy_id,
    });
    if (staffError) throw new Error(staffError.message);
    if (!isStaff) {
      return new Response(JSON.stringify({ error: "Somente equipe da academia" }), {
        status: 403,
        headers,
      });
    }

    // Approval must send now: there is no reliable queue cron in Actions.
    // Explicit false remains available for tests/smoke that only want enqueue.
    const sendImmediately = body.send_immediately !== false;
    const variant = resolveRegistrationApprovedVariant({
      registrationAudience: student.registration_audience,
      paymentReviewStatus: student.payment_review_status,
      pendingFamilyGroupId: student.pending_family_group_id,
      requestedPaymentMethod: student.requested_payment_method,
    });
    const messageBody = buildRegistrationApprovedMessage(
      student.full_name,
      variant,
      student.requested_training_days,
    );
    const idempotencyKey = buildRegistrationApprovedIdempotencyKey(student.id);

    const result = await queueWhatsApp({
      supabase,
      academyId: student.academy_id,
      studentId: student.id,
      recipient: student.whatsapp,
      body: messageBody,
      messageType: "registration_approved",
      idempotencyKey,
      sendImmediately,
    });

    return new Response(
      JSON.stringify({
        success: true,
        queued: true,
        sent: result.sent === true,
        skipped: result.skipped ?? false,
        reason: result.reason,
        message_id: result.messageId,
        event,
      }),
      { headers },
    );
  } catch (error) {
    logSafeError("notify-registration-event failed", {}, error);
    return new Response(JSON.stringify({ error: sanitizeLogError(error) }), {
      status: 500,
      headers,
    });
  }
});
