import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import {
  buildContractApprovedIdempotencyKey,
  buildContractApprovedMessage,
} from "../_shared/whatsapp-messages.ts";
import { logSafeError, sanitizeLogError } from "../_shared/sanitize-log.ts";

type Body = {
  contract_id?: string;
  /** When false/omit, queue only — never force real Evolution send in this path */
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
    const contractId = String(body.contract_id ?? "").trim();
    if (!contractId) {
      return new Response(JSON.stringify({ error: "contract_id obrigatório" }), { status: 400, headers });
    }

    // Payment confirmation WA must deliver; queue cron is not reliable in Actions.
    const sendImmediately = body.send_immediately !== false;

    const supabase = createServiceClient();
    const { data: contract, error: contractError } = await supabase
      .from("student_contracts")
      .select(
        "id, academy_id, student_id, family_group_id, starts_on, ends_on, weekly_frequency, payment_status, contract_status, plans(name, plan_kind, training_days_per_week)",
      )
      .eq("id", contractId)
      .maybeSingle();

    if (contractError) throw new Error(contractError.message);
    if (!contract) {
      return new Response(JSON.stringify({ error: "Contrato não encontrado" }), { status: 404, headers });
    }

    const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin_only", {
      _academy_id: contract.academy_id,
    });
    if (adminError) throw new Error(adminError.message);
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Somente administrador" }), { status: 403, headers });
    }

    if (contract.payment_status !== "pago") {
      return new Response(JSON.stringify({ error: "Contrato ainda não está pago" }), {
        status: 400,
        headers,
      });
    }

    const plan = Array.isArray(contract.plans) ? contract.plans[0] : contract.plans;
    const planName = plan?.name ?? null;
    const planKind = (plan?.plan_kind ?? "").toLowerCase();
    const planKindLabel =
      planKind === "mensal" || planKind === "trimestral" || planKind === "semestral" || planKind === "anual"
        ? planKind.charAt(0).toUpperCase() + planKind.slice(1)
        : null;
    const trainingDays = Number(plan?.training_days_per_week ?? contract.weekly_frequency ?? 0) || null;

    const recipients: Array<{ studentId: string; fullName: string; whatsapp: string }> = [];

    if (contract.student_id) {
      const { data: student } = await supabase
        .from("students")
        .select("id, full_name, whatsapp")
        .eq("id", contract.student_id)
        .maybeSingle();
      if (student?.whatsapp) {
        recipients.push({
          studentId: student.id,
          fullName: student.full_name,
          whatsapp: student.whatsapp,
        });
      }
    } else if (contract.family_group_id) {
      const { data: group } = await supabase
        .from("family_groups")
        .select(
          "financial_responsible_phone, financial_responsible_name, financial_responsible_student_id",
        )
        .eq("id", contract.family_group_id)
        .maybeSingle();

      if (group?.financial_responsible_student_id) {
        const { data: resp } = await supabase
          .from("students")
          .select("id, full_name, whatsapp")
          .eq("id", group.financial_responsible_student_id)
          .maybeSingle();
        if (resp?.whatsapp) {
          recipients.push({
            studentId: resp.id,
            fullName: group.financial_responsible_name || resp.full_name,
            whatsapp: resp.whatsapp,
          });
        }
      } else if (group?.financial_responsible_phone) {
        recipients.push({
          studentId: "",
          fullName: group.financial_responsible_name || "responsável",
          whatsapp: group.financial_responsible_phone,
        });
      }
    }

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, queued: 0, reason: "no_recipient" }),
        { headers },
      );
    }

    const results = [];
    for (const recipient of recipients) {
      const idempotencyKey = buildContractApprovedIdempotencyKey(contractId, "payment_confirmed");
      const queueResult = await queueWhatsApp({
        supabase,
        academyId: contract.academy_id,
        studentId: contract.student_id ?? (recipient.studentId || null),
        recipient: recipient.whatsapp,
        body: buildContractApprovedMessage({
          fullName: recipient.fullName,
          planName,
          planKindLabel,
          trainingDays,
          startsOn: contract.starts_on,
          endsOn: contract.ends_on,
          isFamily: Boolean(contract.family_group_id),
        }),
        messageType: "payment_confirmation",
        idempotencyKey,
        sendImmediately,
      });
      results.push(queueResult);
    }

    return new Response(
      JSON.stringify({ ok: true, event: "payment_confirmed", results }),
      { headers },
    );
  } catch (error) {
    logSafeError("notify-contract-approved failed", {}, error);
    return new Response(JSON.stringify({ error: sanitizeLogError(error) }), {
      status: 500,
      headers,
    });
  }
});
