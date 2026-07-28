import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { requireAdmin, createServiceClient } from "../_shared/supabase.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    await requireAdmin(authHeader);

    const { billingId } = await req.json();
    if (!billingId) {
      return new Response(JSON.stringify({ error: "billingId is required" }), { status: 400, headers });
    }

    const supabase = createServiceClient();
    const { data: billing, error } = await supabase
      .from("billings")
      .select(`
        id, amount, due_date, boleto_url, academy_id, student_id,
        students!inner ( full_name, whatsapp ),
        plans ( name ),
        academies!inner ( name, finance_contact_name, finance_whatsapp )
      `)
      .eq("id", billingId)
      .single();

    if (error || !billing) throw new Error(error?.message ?? "Billing not found");

    const student = Array.isArray(billing.students) ? billing.students[0] : billing.students;
    const academy = Array.isArray(billing.academies) ? billing.academies[0] : billing.academies;
    const plan = Array.isArray(billing.plans) ? billing.plans[0] : billing.plans;

    const message = [
      `${academy?.name ?? "Faith Brothers BJJ"}`,
      "",
      `Olá ${student?.full_name ?? "aluno"}!`,
      "",
      "Segue sua cobrança de mensalidade.",
      `Plano: ${plan?.name ?? "Plano"}`,
      `Valor: R$ ${Number(billing.amount).toFixed(2).replace(".", ",")}`,
      `Vencimento: ${String(billing.due_date).split("-").reverse().join("/")}`,
      billing.boleto_url ? `Boleto/PIX: ${billing.boleto_url}` : "Link indisponível",
      "",
      `Contato: ${academy?.finance_contact_name ?? "Financeiro"} - ${academy?.finance_whatsapp ?? ""}`,
      "OSS!",
    ].join("\n");

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
        .eq("id", billingId);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent: queueResult.sent,
        skipped: queueResult.skipped ?? false,
        reason: queueResult.reason,
        messageId: queueResult.messageId,
      }),
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ ok: false, error: message }), { status, headers });
  }
});
