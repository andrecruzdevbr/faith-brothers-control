import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { sanitizeLogError } from "./sanitize-log.ts";

export const PAYMENT_PAID_EVENTS = [
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_SETTLED",
] as const;

export type PaymentPaidEvent = (typeof PAYMENT_PAID_EVENTS)[number];

export type AsaasWebhookPayload = {
  event?: string;
  payment?: { id?: string };
};

export type AsaasWebhookSuccess = {
  ok: true;
  ignored?: true;
  duplicate?: true;
};

export type AsaasWebhookResponse =
  | AsaasWebhookSuccess
  | { ok: false; error: string };

export type QueueWhatsAppFn = (params: {
  supabase: SupabaseClient;
  academyId?: string | null;
  studentId?: string | null;
  billingId?: string | null;
  recipient: string;
  body: string;
  messageType: "payment_confirmation";
  sendImmediately?: boolean;
}) => Promise<{ messageId: string; sent: boolean }>;

type BillingRow = {
  id: string;
  amount: number;
  academy_id: string;
  student_id: string;
  students:
    | { full_name: string; whatsapp: string | null }
    | { full_name: string; whatsapp: string | null }[];
  plans: { name: string } | { name: string }[] | null;
};

const BILLING_SELECT = `
  id, amount, academy_id, student_id,
  students!inner ( full_name, whatsapp ),
  plans ( name )
`;

export function isPaymentPaidEvent(event: string | undefined): event is PaymentPaidEvent {
  return PAYMENT_PAID_EVENTS.includes(event as PaymentPaidEvent);
}

export function validateAsaasWebhookToken(
  accessToken: string | null,
  expectedToken: string,
): boolean {
  return accessToken === expectedToken;
}

export function buildBillingUpdates(
  event: string,
  paidAt: string,
): Record<string, string | null> | null {
  if (isPaymentPaidEvent(event)) {
    return { status: "pago", paid_at: paidAt };
  }
  if (event === "PAYMENT_OVERDUE") {
    return { status: "vencido" };
  }
  if (event === "PAYMENT_DELETED") {
    return { status: "cancelado" };
  }
  return null;
}

function logWebhookEvent(details: {
  event: string | undefined;
  paymentId: string | undefined;
  billingFound: boolean;
  duplicate?: boolean;
}) {
  console.log(
    JSON.stringify({
      source: "asaas-webhook",
      event: details.event ?? null,
      paymentId: details.paymentId ?? null,
      billingFound: details.billingFound,
      duplicate: details.duplicate ?? false,
    }),
  );
}

async function sendPaymentConfirmation(
  supabase: SupabaseClient,
  billing: BillingRow,
  queueWhatsAppFn: QueueWhatsAppFn,
  confirmedAt: string,
) {
  const student = Array.isArray(billing.students) ? billing.students[0] : billing.students;
  const plan = Array.isArray(billing.plans) ? billing.plans[0] : billing.plans;
  if (!student?.whatsapp) return;

  await queueWhatsAppFn({
    supabase,
    academyId: billing.academy_id,
    studentId: billing.student_id,
    billingId: billing.id,
    recipient: student.whatsapp,
    body: [
      "Faith Brothers BJJ 🥋",
      "",
      `Olá ${student.full_name}!`,
      "",
      "✅ Pagamento confirmado!",
      `Plano: ${plan?.name ?? "Mensalidade"}`,
      `Valor: R$ ${Number(billing.amount).toFixed(2).replace(".", ",")}`,
      "",
      "Obrigado! OSS!",
    ].join("\n"),
    messageType: "payment_confirmation",
    sendImmediately: true,
  });

  await supabase
    .from("whatsapp_messages")
    .update({ status: "confirmed", confirmed_at: confirmedAt })
    .eq("billing_id", billing.id)
    .eq("message_type", "payment_confirmation");
}

export async function processAsaasWebhook(params: {
  payload: AsaasWebhookPayload;
  supabase: SupabaseClient;
  queueWhatsAppFn: QueueWhatsAppFn;
  now?: () => Date;
}): Promise<AsaasWebhookSuccess> {
  const { payload, supabase, queueWhatsAppFn } = params;
  const now = params.now ?? (() => new Date());

  const payment = payload?.payment;
  const event = payload?.event;

  if (!payment?.id) {
    logWebhookEvent({ event, paymentId: undefined, billingFound: false });
    return { ok: true, ignored: true };
  }

  const updates = buildBillingUpdates(event ?? "", now().toISOString());
  if (!updates) {
    logWebhookEvent({ event, paymentId: payment.id, billingFound: false });
    return { ok: true };
  }

  let query = supabase.from("billings").update(updates).eq("asaas_payment_id", payment.id);

  if (isPaymentPaidEvent(event)) {
    query = query.neq("status", "pago");
  }

  const { data: billing, error } = await query.select(BILLING_SELECT).maybeSingle();

  if (error) throw new Error(error.message);

  if (billing && isPaymentPaidEvent(event)) {
    logWebhookEvent({
      event,
      paymentId: payment.id,
      billingFound: true,
      duplicate: false,
    });

    try {
      await sendPaymentConfirmation(
        supabase,
        billing as BillingRow,
        queueWhatsAppFn,
        now().toISOString(),
      );
    } catch (e) {
      console.error("Payment confirmation WhatsApp failed:", sanitizeLogError(e));
    }

    return { ok: true };
  }

  if (isPaymentPaidEvent(event)) {
    const { data: existing, error: lookupError } = await supabase
      .from("billings")
      .select("id, status")
      .eq("asaas_payment_id", payment.id)
      .maybeSingle();

    if (lookupError) throw new Error(lookupError.message);

    if (existing?.status === "pago") {
      logWebhookEvent({
        event,
        paymentId: payment.id,
        billingFound: true,
        duplicate: true,
      });
      return { ok: true, duplicate: true };
    }

    logWebhookEvent({ event, paymentId: payment.id, billingFound: false });
    return { ok: true };
  }

  logWebhookEvent({ event, paymentId: payment.id, billingFound: Boolean(billing) });
  return { ok: true };
}

export async function handleAsaasWebhookRequest(params: {
  accessToken: string | null;
  webhookToken: string;
  payload: AsaasWebhookPayload;
  supabase: SupabaseClient;
  queueWhatsAppFn: QueueWhatsAppFn;
  now?: () => Date;
}): Promise<{ status: number; body: AsaasWebhookResponse | { error: string } }> {
  if (!validateAsaasWebhookToken(params.accessToken, params.webhookToken)) {
    return { status: 401, body: { error: "Invalid webhook token" } };
  }

  try {
    const body = await processAsaasWebhook({
      payload: params.payload,
      supabase: params.supabase,
      queueWhatsAppFn: params.queueWhatsAppFn,
      now: params.now,
    });
    return { status: 200, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { status: 500, body: { ok: false, error: message } };
  }
}
