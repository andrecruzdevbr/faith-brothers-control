import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { getEnv } from "../_shared/env.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import {
  type AcademyBillingSettings,
  getBillingSettings,
  getMissingBillingSkipStatus,
} from "../_shared/billing-settings.ts";
import {
  type BillingProcessStage,
  buildAsaasPaymentsLookupPath,
  buildExternalReference,
  buildFailedProcessedEntry,
  getAsaasPaymentFields,
  pickExistingAsaasPayment,
  shouldCreateAsaasPayment,
  shouldUpdateAsaasCustomer,
} from "../_shared/asaas-billing.ts";
import { normalizeTaxId, sanitizeBillingError } from "../_shared/tax-id.ts";

type StudentBillingProfile = {
  tax_id: string | null;
};

type StudentRow = {
  id: string;
  academy_id: string;
  full_name: string;
  email: string | null;
  whatsapp: string;
  asaas_customer_id: string | null;
  plan_id: string | null;
  plans: { id: string; name: string; monthly_price: number } | null;
  student_billing_profiles:
    | StudentBillingProfile
    | StudentBillingProfile[]
    | null;
  academies: {
    name: string;
    finance_contact_name: string;
    finance_whatsapp: string;
    academy_billing_settings:
      | AcademyBillingSettings
      | AcademyBillingSettings[]
      | null;
  } | null;
};

function monthReference(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function formatDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function getAsaasBaseUrl(): string {
  const raw = getEnv("ASAAS_BASE_URL").trim();
  if (!raw) {
    throw new Error("ASAAS_BASE_URL is not configured");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ASAAS_BASE_URL is invalid");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("ASAAS_BASE_URL must use HTTPS");
  }

  return raw.replace(/\/+$/, "");
}

function getStudentTaxId(
  value: StudentBillingProfile | StudentBillingProfile[] | null | undefined,
): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  const taxId = row?.tax_id ? normalizeTaxId(row.tax_id) : "";
  return /^\d{11}$|^\d{14}$/.test(taxId) ? taxId : null;
}

async function asaasRequest(path: string, init: RequestInit = {}) {
  const apiKey = getEnv("ASAAS_API_KEY");
  const baseUrl = getAsaasBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "FaithBrothersHub/1.0",
      access_token: apiKey,
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Asaas [${response.status}]: ${JSON.stringify(data)}`);
  return data;
}

async function getAuthorizedAdminAcademyId(authHeader: string) {
  const supabase = createUserClient(authHeader);
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) throw new Error("Unauthorized");

  const userId = claimsData.claims.sub as string;
  const { data: roleData, error: roleError } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (roleError || !roleData) throw new Error("Forbidden");

  const { data: profile, error: profileError } = await supabase.from("profiles").select("academy_id").eq("user_id", userId).single();
  if (profileError || !profile?.academy_id) throw new Error("Forbidden");
  return profile.academy_id as string;
}

async function ensureAsaasCustomer(
  supabase: ReturnType<typeof createServiceClient>,
  student: StudentRow,
  cpfCnpj: string,
  setStage: (stage: BillingProcessStage) => void,
) {
  const payload = {
    name: student.full_name,
    cpfCnpj,
    email: student.email,
    mobilePhone: student.whatsapp.replace(/\D/g, ""),
    notificationDisabled: true,
  };

  if (student.asaas_customer_id) {
    setStage("update_asaas_customer");
    const existing = await asaasRequest(`/customers/${student.asaas_customer_id}`);
    const existingCpf = normalizeTaxId(String(existing.cpfCnpj ?? ""));
    if (shouldUpdateAsaasCustomer(existingCpf, cpfCnpj)) {
      await asaasRequest(`/customers/${student.asaas_customer_id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    }
    return student.asaas_customer_id;
  }

  setStage("ensure_customer");
  const customer = await asaasRequest("/customers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await supabase.from("students").update({ asaas_customer_id: customer.id }).eq("id", student.id);
  return customer.id as string;
}

function buildBillingMessage(student: StudentRow, planName: string, amount: number, dueDate: string, boletoUrl: string | null) {
  return [
    `${student.academies?.name ?? "Faith Brothers BJJ"}`,
    "",
    `Olá ${student.full_name}!`,
    "",
    "Sua mensalidade foi gerada.",
    `Plano: ${planName}`,
    `Valor: R$ ${amount.toFixed(2).replace(".", ",")}`,
    `Vencimento: ${dueDate.split("-").reverse().join("/")}`,
    boletoUrl ? `Boleto/PIX: ${boletoUrl}` : "",
    "",
    `Dúvidas: ${student.academies?.finance_contact_name ?? "Financeiro"} - ${student.academies?.finance_whatsapp ?? ""}`,
    "OSS!",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    getAsaasBaseUrl();
    getEnv("ASAAS_API_KEY");

    const authHeader = req.headers.get("Authorization");
    const cronSecret = getEnv("BILLING_CRON_SECRET");
    const isCronCall = req.headers.get("x-cron-secret") === cronSecret;
    let academyIdFilter: string | null = null;

    if (!isCronCall) {
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      }
      academyIdFilter = await getAuthorizedAdminAcademyId(authHeader);
    }

    const supabase = createServiceClient();
    const now = new Date();
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth();
    const referenceMonth = monthReference(now);
    const today = now.getUTCDate();

    let studentsQuery = supabase
      .from("students")
      .select(`
        id, academy_id, full_name, email, whatsapp, asaas_customer_id, plan_id,
        student_billing_profiles ( tax_id ),
        plans ( id, name, monthly_price ),
        academies!inner ( name, finance_contact_name, finance_whatsapp,
          academy_billing_settings ( boleto_issue_day, boleto_due_day, send_whatsapp_automatically )
        )
      `)
      .eq("status", "ativo")
      .not("plan_id", "is", null);

    if (academyIdFilter) studentsQuery = studentsQuery.eq("academy_id", academyIdFilter);

    const { data: students, error: studentsError } = await studentsQuery;
    if (studentsError) throw new Error(studentsError.message);

    const processed: Array<{
      studentId: string;
      billingId?: string;
      status: string;
      stage?: BillingProcessStage;
      error?: string;
    }> = [];

    for (const student of (students ?? []) as unknown as StudentRow[]) {
      const plan = student.plans!;
      const settings = getBillingSettings(student.academies?.academy_billing_settings)!;
      const skipStatus = getMissingBillingSkipStatus(!!plan, !!settings);
      if (skipStatus) {
        processed.push({ studentId: student.id, status: skipStatus });
        continue;
      }
      if (today < settings.boleto_issue_day) {
        processed.push({ studentId: student.id, status: "skipped_before_issue_day" });
        continue;
      }

      const { data: existingBilling } = await supabase
        .from("billings")
        .select("id")
        .eq("student_id", student.id)
        .eq("reference_month", referenceMonth)
        .maybeSingle();

      if (existingBilling) {
        processed.push({ studentId: student.id, billingId: existingBilling.id, status: "already_exists" });
        continue;
      }

      const taxId = getStudentTaxId(student.student_billing_profiles);
      if (!taxId) {
        processed.push({ studentId: student.id, status: "skipped_missing_tax_id" });
        continue;
      }

      let insertedBillingId: string | undefined;
      let stage: BillingProcessStage = "ensure_customer";
      try {
        const customerId = await ensureAsaasCustomer(supabase, student, taxId, (next) => {
          stage = next;
        });
        const dueDate = formatDate(year, monthIndex, settings.boleto_due_day);
        const issueDate = formatDate(year, monthIndex, settings.boleto_issue_day);
        const externalReference = buildExternalReference(student.id, referenceMonth);

        stage = "find_existing_asaas_payment";
        const lookupResponse = await asaasRequest(buildAsaasPaymentsLookupPath(externalReference));
        let paymentRecord = pickExistingAsaasPayment(lookupResponse);

        if (shouldCreateAsaasPayment(paymentRecord)) {
          stage = "create_asaas_payment";
          paymentRecord = await asaasRequest("/payments", {
            method: "POST",
            body: JSON.stringify({
              customer: customerId,
              billingType: "UNDEFINED",
              value: plan.monthly_price,
              dueDate,
              description: `${student.academies?.name ?? "Academia"} - ${plan.name} - ${referenceMonth}`,
              externalReference,
            }),
          });
        }

        const payment = getAsaasPaymentFields(paymentRecord);
        if (!payment.id) {
          throw new Error("Asaas payment response missing id");
        }

        stage = "insert_local_billing";
        const { data: insertedBilling, error: billingInsertError } = await supabase
          .from("billings")
          .insert({
            academy_id: student.academy_id,
            student_id: student.id,
            plan_id: plan.id,
            reference_month: referenceMonth,
            amount: plan.monthly_price,
            issue_date: issueDate,
            due_date: dueDate,
            status: settings.send_whatsapp_automatically ? "gerado" : "pendente",
            asaas_payment_id: payment.id,
            boleto_url: payment.boletoUrl,
            invoice_number: payment.invoiceNumber,
          })
          .select("id, boleto_url")
          .single();

        if (billingInsertError || !insertedBilling) throw new Error(billingInsertError?.message ?? "insert failed");
        insertedBillingId = insertedBilling.id;

        if (settings.send_whatsapp_automatically) {
          stage = "queue_whatsapp";
          const whatsappResult = await queueWhatsApp({
            supabase,
            academyId: student.academy_id,
            studentId: student.id,
            billingId: insertedBilling.id,
            recipient: student.whatsapp,
            body: buildBillingMessage(student, plan.name, plan.monthly_price, dueDate, insertedBilling.boleto_url),
            messageType: "billing",
            sendImmediately: true,
          });
          if (whatsappResult.sent) {
            await supabase
              .from("billings")
              .update({ status: "enviado_whatsapp", whatsapp_sent_at: new Date().toISOString() })
              .eq("id", insertedBilling.id);
            processed.push({ studentId: student.id, billingId: insertedBilling.id, status: "sent_whatsapp" });
          } else {
            processed.push({
              studentId: student.id,
              billingId: insertedBilling.id,
              status: whatsappResult.skipped ? "queued_whatsapp_send_disabled" : "generated",
            });
          }
        } else {
          processed.push({ studentId: student.id, billingId: insertedBilling.id, status: "generated" });
        }
      } catch (error) {
        const message = sanitizeBillingError(error instanceof Error ? error.message : "Unknown error");
        console.error("generate-monthly-billings student failed", {
          studentId: student.id,
          academyId: student.academy_id,
          stage,
          message,
        });
        if (insertedBillingId) {
          await supabase.from("billings").update({ status: "falhou", last_error: message }).eq("id", insertedBillingId);
        }
        processed.push(buildFailedProcessedEntry({
          studentId: student.id,
          stage,
          error: message,
          billingId: insertedBillingId,
        }));
      }
    }

    return new Response(JSON.stringify({ success: true, processed }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ success: false, error: message }), { status, headers });
  }
});
