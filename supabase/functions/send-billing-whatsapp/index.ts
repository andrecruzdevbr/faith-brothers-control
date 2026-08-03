import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { requireAdmin, createServiceClient } from "../_shared/supabase.ts";
import { getEnv } from "../_shared/env.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import {
  hasValidStudentWhatsapp,
  summarizeBillingProcessed,
  type BillingProcessedEntry,
} from "../_shared/billing-settings.ts";
import { assertSendableBoletoUrl } from "../_shared/billing-boleto.ts";
import {
  OVERDUE_BILLING_STATUSES,
  buildOverdueReminderMessage,
  isAfterOverdueReminderDay,
} from "../_shared/billing-overdue.ts";

type SendBody = {
  billingId?: string;
  /** Envia cobranças abertas do mês / lembrete de atraso. */
  scope?: "single" | "pending_month" | "overdue_reminder";
  /** Permite reenviar mesmo se já foi enviado (single). */
  resend?: boolean;
};

function monthReference(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function buildMessage(params: {
  academyName: string;
  studentName: string;
  planName: string;
  amount: number;
  dueDate: string;
  boletoUrl: string;
  financeContact: string;
  financeWhatsapp: string;
}) {
  return [
    params.academyName,
    "",
    `Olá ${params.studentName}!`,
    "",
    "Segue sua cobrança de mensalidade.",
    `Plano: ${params.planName}`,
    `Valor: R$ ${params.amount.toFixed(2).replace(".", ",")}`,
    `Vencimento: ${params.dueDate.split("-").reverse().join("/")}`,
    `Boleto/PIX: ${params.boletoUrl}`,
    "",
    `Contato: ${params.financeContact} - ${params.financeWhatsapp}`,
    "OSS!",
  ].join("\n");
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const cronSecret = getEnv("BILLING_CRON_SECRET");
    const isCronCall = req.headers.get("x-cron-secret") === cronSecret;

    let academyIdFilter: string | null = null;
    let body: SendBody = {};

    if (req.method === "POST") {
      try {
        body = (await req.json()) as SendBody;
      } catch {
        body = {};
      }
    }

    if (!isCronCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      }
      const { userId, supabase: userClient } = await requireAdmin(authHeader);
      const { data: profile, error: profileError } = await userClient
        .from("profiles")
        .select("academy_id")
        .eq("user_id", userId)
        .single();
      if (profileError || !profile?.academy_id) throw new Error("Forbidden");
      academyIdFilter = profile.academy_id as string;
    }

    const resend = body.resend === true;
    const effectiveScope = isCronCall
      ? "overdue_reminder"
      : body.scope === "pending_month"
        ? "pending_month"
        : body.scope === "overdue_reminder"
          ? "overdue_reminder"
          : "single";

    const supabase = createServiceClient();
    const now = new Date();
    const referenceMonth = monthReference(now);
    const processed: BillingProcessedEntry[] = [];

    let billingsQuery = supabase
      .from("billings")
      .select(`
        id, amount, due_date, boleto_url, academy_id, student_id, status, whatsapp_sent_at, reference_month,
        students!inner ( full_name, whatsapp, status ),
        plans ( name ),
        academies!inner ( name, finance_contact_name, finance_whatsapp )
      `);

    if (academyIdFilter) {
      billingsQuery = billingsQuery.eq("academy_id", academyIdFilter);
    }

    if (effectiveScope === "overdue_reminder") {
      billingsQuery = billingsQuery
        .in("status", [...OVERDUE_BILLING_STATUSES])
        .eq("students.status", "ativo")
        .not("boleto_url", "is", null);
    } else if (effectiveScope === "pending_month") {
      billingsQuery = billingsQuery
        .eq("reference_month", referenceMonth)
        .in("status", ["pendente", "gerado", "enviado_whatsapp"])
        .eq("students.status", "ativo")
        .not("boleto_url", "is", null);
    } else {
      if (!body.billingId) {
        return new Response(JSON.stringify({ error: "billingId is required" }), { status: 400, headers });
      }
      billingsQuery = billingsQuery.eq("id", body.billingId);
    }

    const { data: billings, error } = await billingsQuery;
    if (error) throw new Error(error.message);
    if (!billings?.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          referenceMonth,
          scope: effectiveScope,
          summary: summarizeBillingProcessed([]),
          processed: [],
          overdueFound: 0,
        }),
        { headers },
      );
    }

    let overdueFound = 0;

    for (const billing of billings) {
      const student = unwrapOne(billing.students as { full_name: string; whatsapp: string; status: string } | { full_name: string; whatsapp: string; status: string }[]);
      const academy = unwrapOne(billing.academies as { name: string; finance_contact_name: string; finance_whatsapp: string } | { name: string; finance_contact_name: string; finance_whatsapp: string }[]);
      const plan = unwrapOne(billing.plans as { name: string } | { name: string }[]);

      if (student?.status && student.status !== "ativo") {
        processed.push({
          studentId: billing.student_id,
          studentName: student.full_name,
          billingId: billing.id,
          status: "whatsapp_skipped_paid",
        });
        continue;
      }

      if (billing.status === "pago" || billing.status === "cancelado") {
        processed.push({
          studentId: billing.student_id,
          billingId: billing.id,
          status: "whatsapp_skipped_paid",
        });
        continue;
      }

      const boletoCheck = assertSendableBoletoUrl(billing.boleto_url);
      if (!boletoCheck.ok) {
        processed.push({
          studentId: billing.student_id,
          billingId: billing.id,
          status:
            boletoCheck.reason === "sandbox_boleto"
              ? "whatsapp_skipped_sandbox_boleto"
              : "whatsapp_skipped_no_boleto",
        });
        continue;
      }

      if (effectiveScope === "overdue_reminder") {
        if (!isAfterOverdueReminderDay(String(billing.due_date), now)) {
          processed.push({
            studentId: billing.student_id,
            studentName: student?.full_name,
            billingId: billing.id,
            status: "overdue_reminder_too_early",
          });
          continue;
        }
        overdueFound += 1;

        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recentReminder } = await supabase
          .from("whatsapp_messages")
          .select("id")
          .eq("billing_id", billing.id)
          .eq("message_type", "billing_overdue")
          .in("status", ["sent", "confirmed", "pending", "processing"])
          .gte("created_at", weekAgo)
          .limit(1)
          .maybeSingle();

        if (recentReminder) {
          processed.push({
            studentId: billing.student_id,
            studentName: student?.full_name,
            billingId: billing.id,
            status: "overdue_reminder_already_sent",
          });
          continue;
        }
      }

      if (
        (effectiveScope === "pending_month" || effectiveScope === "single") &&
        !resend &&
        billing.status === "enviado_whatsapp" &&
        billing.whatsapp_sent_at
      ) {
        processed.push({
          studentId: billing.student_id,
          billingId: billing.id,
          status: "whatsapp_already_sent",
        });
        continue;
      }

      if (!hasValidStudentWhatsapp(student?.whatsapp)) {
        processed.push({
          studentId: billing.student_id,
          studentName: student?.full_name,
          billingId: billing.id,
          status: "whatsapp_skipped_missing_recipient",
        });
        continue;
      }

      const message =
        effectiveScope === "overdue_reminder"
          ? buildOverdueReminderMessage({
              academyName: academy?.name ?? "Faith Brothers BJJ",
              studentName: student?.full_name ?? "aluno",
              referenceMonth: String(billing.reference_month),
              dueDate: String(billing.due_date),
              boletoUrl: boletoCheck.url,
              financeContact: academy?.finance_contact_name ?? "Financeiro",
              financeWhatsapp: academy?.finance_whatsapp ?? "",
            })
          : buildMessage({
              academyName: academy?.name ?? "Faith Brothers BJJ",
              studentName: student?.full_name ?? "aluno",
              planName: plan?.name ?? "Plano",
              amount: Number(billing.amount),
              dueDate: String(billing.due_date),
              boletoUrl: boletoCheck.url,
              financeContact: academy?.finance_contact_name ?? "Financeiro",
              financeWhatsapp: academy?.finance_whatsapp ?? "",
            });

      const queueResult = await queueWhatsApp({
        supabase,
        academyId: billing.academy_id,
        studentId: billing.student_id,
        billingId: billing.id,
        recipient: student?.whatsapp ?? "",
        body: message,
        messageType: effectiveScope === "overdue_reminder" ? "billing_overdue" : "billing",
        sendImmediately: true,
      });

      if (queueResult.sent) {
        if (effectiveScope !== "overdue_reminder") {
          await supabase
            .from("billings")
            .update({ status: "enviado_whatsapp", whatsapp_sent_at: new Date().toISOString() })
            .eq("id", billing.id);
        }
        processed.push({
          studentId: billing.student_id,
          studentName: student?.full_name,
          billingId: billing.id,
          status: effectiveScope === "overdue_reminder" ? "overdue_reminder_sent" : "whatsapp_sent",
        });
      } else {
        processed.push({
          studentId: billing.student_id,
          studentName: student?.full_name,
          billingId: billing.id,
          status: effectiveScope === "overdue_reminder" ? "overdue_reminder_skipped" : "whatsapp_skipped",
        });
      }
    }

    const summary = summarizeBillingProcessed(processed);
    const first = processed[0];

    return new Response(
      JSON.stringify({
        ok: true,
        referenceMonth,
        scope: effectiveScope,
        summary,
        processed,
        overdueFound: effectiveScope === "overdue_reminder" ? overdueFound : undefined,
        sent: first?.status === "whatsapp_sent" || first?.status === "overdue_reminder_sent",
        skipped:
          first?.status !== "whatsapp_sent" && first?.status !== "overdue_reminder_sent",
        reason:
          first?.status === "whatsapp_sent" || first?.status === "overdue_reminder_sent"
            ? undefined
            : first?.status,
      }),
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ ok: false, error: message }), { status, headers });
  }
});
