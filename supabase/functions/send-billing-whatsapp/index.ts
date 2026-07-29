import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { requireAdmin, createServiceClient } from "../_shared/supabase.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import {
  hasValidStudentWhatsapp,
  summarizeBillingProcessed,
  type BillingProcessedEntry,
} from "../_shared/billing-settings.ts";

type SendBody = {
  billingId?: string;
  /** Envia cobranças abertas do mês de referência atual (não pagas). */
  scope?: "single" | "pending_month";
  /** Permite reenviar mesmo se já foi enviado. */
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
  boletoUrl: string | null;
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
    params.boletoUrl ? `Boleto/PIX: ${params.boletoUrl}` : "Link indisponível",
    "",
    `Contato: ${params.financeContact} - ${params.financeWhatsapp}`,
    "OSS!",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
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
    const academyId = profile.academy_id as string;

    const body = (await req.json()) as SendBody;
    const scope = body.scope === "pending_month" ? "pending_month" : "single";
    const resend = body.resend === true;

    const supabase = createServiceClient();
    const referenceMonth = monthReference();
    const processed: BillingProcessedEntry[] = [];

    let billingsQuery = supabase
      .from("billings")
      .select(`
        id, amount, due_date, boleto_url, academy_id, student_id, status, whatsapp_sent_at, reference_month,
        students!inner ( full_name, whatsapp ),
        plans ( name ),
        academies!inner ( name, finance_contact_name, finance_whatsapp )
      `)
      .eq("academy_id", academyId);

    if (scope === "pending_month") {
      billingsQuery = billingsQuery
        .eq("reference_month", referenceMonth)
        .in("status", ["pendente", "gerado", "enviado_whatsapp"])
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
          summary: summarizeBillingProcessed([]),
          processed: [],
        }),
        { headers },
      );
    }

    for (const billing of billings) {
      const student = Array.isArray(billing.students) ? billing.students[0] : billing.students;
      const academy = Array.isArray(billing.academies) ? billing.academies[0] : billing.academies;
      const plan = Array.isArray(billing.plans) ? billing.plans[0] : billing.plans;

      if (billing.status === "pago" || billing.status === "cancelado") {
        processed.push({
          studentId: billing.student_id,
          billingId: billing.id,
          status: "whatsapp_skipped_paid",
        });
        continue;
      }

      if (!billing.boleto_url) {
        processed.push({
          studentId: billing.student_id,
          billingId: billing.id,
          status: "whatsapp_skipped_no_boleto",
        });
        continue;
      }

      if (
        scope === "pending_month" &&
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
          billingId: billing.id,
          status: "whatsapp_skipped_missing_recipient",
        });
        continue;
      }

      const message = buildMessage({
        academyName: academy?.name ?? "Faith Brothers BJJ",
        studentName: student?.full_name ?? "aluno",
        planName: plan?.name ?? "Plano",
        amount: Number(billing.amount),
        dueDate: String(billing.due_date),
        boletoUrl: billing.boleto_url,
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
        messageType: "billing",
        sendImmediately: true,
      });

      if (queueResult.sent) {
        await supabase
          .from("billings")
          .update({ status: "enviado_whatsapp", whatsapp_sent_at: new Date().toISOString() })
          .eq("id", billing.id);
        processed.push({
          studentId: billing.student_id,
          billingId: billing.id,
          status: "whatsapp_sent",
        });
      } else {
        processed.push({
          studentId: billing.student_id,
          billingId: billing.id,
          status: "whatsapp_skipped",
        });
      }
    }

    const summary = summarizeBillingProcessed(processed);
    const first = processed[0];

    return new Response(
      JSON.stringify({
        ok: true,
        referenceMonth,
        scope,
        summary,
        processed,
        // Compatível com o frontend individual atual
        sent: first?.status === "whatsapp_sent",
        skipped: first?.status !== "whatsapp_sent",
        reason: first?.status === "whatsapp_sent" ? undefined : first?.status,
      }),
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ ok: false, error: message }), { status, headers });
  }
});
