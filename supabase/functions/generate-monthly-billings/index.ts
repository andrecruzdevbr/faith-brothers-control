import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { getEnv } from "../_shared/env.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import {
  type AcademyBillingSettings,
  type BillingProcessedEntry,
  getBillingSettings,
  getMissingBillingSkipStatus,
  getBrazilCivilDate,
  hasValidStudentWhatsapp,
  resolveBillingPeriod,
  resolveSendWhatsApp,
  shouldSkipBeforeIssueDay,
  summarizeBillingProcessed,
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
  unwrapRelation,
} from "../_shared/asaas-billing.ts";
import { normalizeTaxId, sanitizeBillingError } from "../_shared/tax-id.ts";
import { assertSendableBoletoUrl } from "../_shared/billing-boleto.ts";
import { canReprocessFailedBilling } from "../_shared/billing-overdue.ts";

type StudentBillingProfile = {
  tax_id: string | null;
};

type PlanEmbed = {
  id: string;
  name: string;
  monthly_price: number;
  billing_mode?: string | null;
};
type AcademyEmbed = {
  name: string;
  finance_contact_name: string;
  finance_whatsapp: string;
  academy_billing_settings:
    | AcademyBillingSettings
    | AcademyBillingSettings[]
    | null;
};

type StudentRow = {
  id: string;
  academy_id: string;
  full_name: string;
  email: string | null;
  whatsapp: string;
  asaas_customer_id: string | null;
  plan_id: string | null;
  plans: PlanEmbed | PlanEmbed[] | null;
  student_billing_profiles:
    | StudentBillingProfile
    | StudentBillingProfile[]
    | null;
  academies: AcademyEmbed | AcademyEmbed[] | null;
};

type GenerateBody = {
  studentId?: string;
  student_id?: string;
  force?: boolean;
  sendWhatsApp?: boolean;
  /** YYYY-MM-01 ou YYYY-MM — se omitido, usa próxima referência válida (dia 15). */
  referenceMonth?: string;
};

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

function resolveStudentIdFilter(body: GenerateBody): string | null {
  const raw = body.studentId ?? body.student_id;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
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
  const raw = await response.text();
  let data: unknown = {};
  if (raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Asaas [${response.status}]: invalid JSON response`);
    }
  }
  if (!response.ok) {
    throw new Error(`Asaas [${response.status}]: ${JSON.stringify(data)}`);
  }
  return data as Record<string, unknown>;
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
    try {
      const existing = await asaasRequest(`/customers/${student.asaas_customer_id}`);
      const existingCpf = normalizeTaxId(String(existing.cpfCnpj ?? ""));
      if (shouldUpdateAsaasCustomer(existingCpf, cpfCnpj)) {
        await asaasRequest(`/customers/${student.asaas_customer_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }
      return student.asaas_customer_id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Customer órfão/sandbox: recria em vez de abortar a cobrança.
      if (!message.includes("Asaas [404]")) throw error;
      await supabase.from("students").update({ asaas_customer_id: null }).eq("id", student.id);
    }
  }

  setStage("ensure_customer");
  const customer = await asaasRequest("/customers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await supabase.from("students").update({ asaas_customer_id: customer.id }).eq("id", student.id);
  return customer.id as string;
}

function buildBillingMessage(
  academy: AcademyEmbed | null,
  studentName: string,
  planName: string,
  amount: number,
  dueDate: string,
  boletoUrl: string | null,
) {
  return [
    `${academy?.name ?? "Faith Brothers BJJ"}`,
    "",
    `Olá ${studentName}!`,
    "",
    "Sua mensalidade foi gerada.",
    `Plano: ${planName}`,
    `Valor: R$ ${amount.toFixed(2).replace(".", ",")}`,
    `Vencimento: ${dueDate.split("-").reverse().join("/")}`,
    boletoUrl ? `Boleto/PIX: ${boletoUrl}` : "",
    "",
    `Dúvidas: ${academy?.finance_contact_name ?? "Financeiro"} - ${academy?.finance_whatsapp ?? ""}`,
    "OSS!",
  ].filter(Boolean).join("\n");
}

async function dispatchBillingWhatsApp(params: {
  supabase: ReturnType<typeof createServiceClient>;
  student: StudentRow;
  academy: AcademyEmbed | null;
  billingId: string;
  planName: string;
  amount: number;
  dueDate: string;
  boletoUrl: string | null;
}): Promise<
  | "sent_whatsapp"
  | "queued_whatsapp_send_disabled"
  | "skipped_missing_whatsapp"
  | "whatsapp_skipped_no_boleto"
  | "whatsapp_skipped_sandbox_boleto"
> {
  if (!hasValidStudentWhatsapp(params.student.whatsapp)) {
    return "skipped_missing_whatsapp";
  }

  const boletoCheck = assertSendableBoletoUrl(params.boletoUrl);
  if (!boletoCheck.ok) {
    return boletoCheck.reason === "sandbox_boleto"
      ? "whatsapp_skipped_sandbox_boleto"
      : "whatsapp_skipped_no_boleto";
  }

  const whatsappResult = await queueWhatsApp({
    supabase: params.supabase,
    academyId: params.student.academy_id,
    studentId: params.student.id,
    billingId: params.billingId,
    recipient: params.student.whatsapp,
    body: buildBillingMessage(
      params.academy,
      params.student.full_name,
      params.planName,
      params.amount,
      params.dueDate,
      boletoCheck.url,
    ),
    messageType: "billing",
    sendImmediately: true,
  });

  if (whatsappResult.sent) {
    await params.supabase
      .from("billings")
      .update({ status: "enviado_whatsapp", whatsapp_sent_at: new Date().toISOString() })
      .eq("id", params.billingId);
    return "sent_whatsapp";
  }

  return whatsappResult.skipped ? "queued_whatsapp_send_disabled" : "queued_whatsapp_send_disabled";
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
    let body: GenerateBody = {};

    if (req.method === "POST") {
      try {
        body = (await req.json()) as GenerateBody;
      } catch {
        body = {};
      }
    }

    const force = body.force === true;
    const studentIdFilter = resolveStudentIdFilter(body);
    const sendWhatsAppOverride =
      typeof body.sendWhatsApp === "boolean" ? body.sendWhatsApp : undefined;
    const requestedReferenceMonth =
      typeof body.referenceMonth === "string" && body.referenceMonth.trim()
        ? body.referenceMonth.trim()
        : null;

    if (!isCronCall) {
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      }
      academyIdFilter = await getAuthorizedAdminAcademyId(authHeader);
    }

    const supabase = createServiceClient();
    const now = new Date();
    const today = getBrazilCivilDate(now).day;

    // Período padrão (dia 15). Pode ser sobrescrito por aluno se settings diferirem.
    const defaultPeriodResult = resolveBillingPeriod({
      now,
      dueDay: 15,
      issueDay: 10,
      referenceMonth: requestedReferenceMonth,
      rejectPast: false,
    });
    if (defaultPeriodResult.error) {
      return new Response(
        JSON.stringify({ success: false, error: defaultPeriodResult.error }),
        { status: 400, headers },
      );
    }

    let runPeriod = defaultPeriodResult.period;
    let referenceAdjusted = defaultPeriodResult.adjusted;

    let studentsQuery = supabase
      .from("students")
      .select(`
        id, academy_id, full_name, email, whatsapp, asaas_customer_id, plan_id,
        student_billing_profiles ( tax_id ),
        plans ( id, name, monthly_price, billing_mode ),
        academies!inner ( name, finance_contact_name, finance_whatsapp,
          academy_billing_settings ( boleto_issue_day, boleto_due_day, send_whatsapp_automatically )
        )
      `)
      .eq("status", "ativo")
      .not("plan_id", "is", null);

    if (academyIdFilter) studentsQuery = studentsQuery.eq("academy_id", academyIdFilter);
    if (studentIdFilter) studentsQuery = studentsQuery.eq("id", studentIdFilter);

    const { data: students, error: studentsError } = await studentsQuery;
    if (studentsError) throw new Error(studentsError.message);

    const processed: BillingProcessedEntry[] = [];
    const whatsappHandledBillingIds = new Set<string>();

    if (studentIdFilter && (!students || students.length === 0)) {
      processed.push(
        buildFailedProcessedEntry({
          studentId: studentIdFilter,
          studentName: "Aluno não elegível",
          stage: "resolve_student",
          error:
            "Aluno não encontrado para cobrança. Verifique se está ativo, com plano vinculado e na mesma academia.",
        }),
      );
    }

    for (const student of (students ?? []) as unknown as StudentRow[]) {
      const plan = unwrapRelation(student.plans);
      const academy = unwrapRelation(student.academies);
      const settings = getBillingSettings(academy?.academy_billing_settings);
      const skipStatus = getMissingBillingSkipStatus(!!plan, !!settings);
      if (skipStatus || !plan || !settings) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: skipStatus ?? "skipped_missing_billing_settings",
        });
        continue;
      }

      const periodResult = resolveBillingPeriod({
        now,
        dueDay: settings.boleto_due_day,
        issueDay: settings.boleto_issue_day,
        referenceMonth: requestedReferenceMonth ?? runPeriod.referenceMonth,
        rejectPast: false,
      });
      if (periodResult.error) {
        processed.push(
          buildFailedProcessedEntry({
            studentId: student.id,
            studentName: student.full_name,
            stage: "create_asaas_payment",
            error: periodResult.error,
          }),
        );
        continue;
      }
      const period = periodResult.period;
      runPeriod = period;
      if (periodResult.adjusted) referenceAdjusted = true;

      // Prepaid / family coverage: never create Asaas boleto for covered months
      try {
        const { data: skipReason } = await supabase.rpc("prepaid_cron_skip_reason" as never, {
          _student_id: student.id,
          _reference_month: period.referenceMonth,
        } as never);
        if (typeof skipReason === "string" && skipReason.length > 0) {
          processed.push({
            studentId: student.id,
            studentName: student.full_name,
            status: skipReason as BillingProcessedEntry["status"],
          });
          continue;
        }
      } catch {
        // If migration not applied yet, fall through to billing_mode check below.
      }

      const billingMode = String(plan.billing_mode ?? "asaas_monthly");
      if (billingMode !== "asaas_monthly") {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: "skipped_non_asaas_plan" as BillingProcessedEntry["status"],
        });
        continue;
      }

      if (shouldSkipBeforeIssueDay(today, settings.boleto_issue_day, force)) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: "skipped_before_issue_day",
        });
        continue;
      }

      if (!hasValidStudentWhatsapp(student.whatsapp)) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: "skipped_missing_whatsapp",
        });
        continue;
      }

      const planAmount = Number(plan.monthly_price);
      if (!Number.isFinite(planAmount) || planAmount <= 0) {
        processed.push(
          buildFailedProcessedEntry({
            studentId: student.id,
            studentName: student.full_name,
            stage: "create_asaas_payment",
            error: "Valor do plano inválido. Atualize o plano do aluno antes de gerar cobrança.",
          }),
        );
        continue;
      }

      const sendWhatsApp = resolveSendWhatsApp(settings.send_whatsapp_automatically, sendWhatsAppOverride);

      const { data: existingBilling } = await supabase
        .from("billings")
        .select("id, status, boleto_url, amount, due_date, plan_id, plans(name)")
        .eq("student_id", student.id)
        .eq("reference_month", period.referenceMonth)
        .maybeSingle();

      let reprocessBillingId: string | null = null;

      if (existingBilling) {
        if (existingBilling.status === "pago") {
          processed.push({
            studentId: student.id,
            studentName: student.full_name,
            billingId: existingBilling.id,
            status: "already_exists",
          });
          continue;
        }

        if (canReprocessFailedBilling(existingBilling.status)) {
          reprocessBillingId = existingBilling.id;
        } else {
          processed.push({
            studentId: student.id,
            studentName: student.full_name,
            billingId: existingBilling.id,
            status: "already_exists",
          });

          if (
            sendWhatsApp &&
            existingBilling.boleto_url &&
            (existingBilling.status === "pendente" || existingBilling.status === "gerado")
          ) {
            const existingPlan = unwrapRelation(
              existingBilling.plans as { name: string } | { name: string }[] | null,
            );
            const planName = existingPlan?.name ?? plan.name;
            const waStatus = await dispatchBillingWhatsApp({
              supabase,
              student,
              academy,
              billingId: existingBilling.id,
              planName,
              amount: Number(existingBilling.amount),
              dueDate: String(existingBilling.due_date),
              boletoUrl: existingBilling.boleto_url,
            });
            whatsappHandledBillingIds.add(existingBilling.id);
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: existingBilling.id,
              status:
                waStatus === "sent_whatsapp"
                  ? "whatsapp_sent"
                  : waStatus === "skipped_missing_whatsapp"
                    ? "whatsapp_skipped_missing_recipient"
                    : waStatus === "whatsapp_skipped_sandbox_boleto"
                      ? "whatsapp_skipped_sandbox_boleto"
                      : waStatus === "whatsapp_skipped_no_boleto"
                        ? "whatsapp_skipped_no_boleto"
                        : "whatsapp_skipped",
            });
          }
          continue;
        }
      }

      const taxId = getStudentTaxId(student.student_billing_profiles);
      if (!taxId) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: "skipped_missing_tax_id",
        });
        continue;
      }

      let insertedBillingId: string | undefined = reprocessBillingId ?? undefined;
      let stage: BillingProcessStage = "ensure_customer";
      try {
        const customerId = await ensureAsaasCustomer(supabase, student, taxId, (next) => {
          stage = next;
        });
        const dueDate = period.dueDate;
        const issueDate = period.issueDate;
        const externalReference = buildExternalReference(student.id, period.referenceMonth);

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
              value: planAmount,
              dueDate,
              description: `${academy?.name ?? "Academia"} - ${plan.name} - ${period.referenceMonth}`,
              externalReference,
            }),
          });
        }

        const payment = getAsaasPaymentFields(paymentRecord);
        if (!payment.id) {
          throw new Error("Asaas payment response missing id");
        }

        stage = "insert_local_billing";
        const billingPayload = {
          academy_id: student.academy_id,
          student_id: student.id,
          plan_id: plan.id,
          reference_month: period.referenceMonth,
          amount: planAmount,
          issue_date: issueDate,
          due_date: dueDate,
          status: sendWhatsApp ? "gerado" : "pendente",
          asaas_payment_id: payment.id,
          boleto_url: payment.boletoUrl,
          invoice_number: payment.invoiceNumber,
          last_error: null as string | null,
        };

        let insertedBilling: { id: string; boleto_url: string | null } | null = null;
        if (reprocessBillingId) {
          const { data, error: billingUpdateError } = await supabase
            .from("billings")
            .update(billingPayload)
            .eq("id", reprocessBillingId)
            .select("id, boleto_url")
            .single();
          if (billingUpdateError || !data) {
            throw new Error(billingUpdateError?.message ?? "update failed");
          }
          insertedBilling = data;
        } else {
          const { data, error: billingInsertError } = await supabase
            .from("billings")
            .insert(billingPayload)
            .select("id, boleto_url")
            .single();
          if (billingInsertError || !data) {
            throw new Error(billingInsertError?.message ?? "insert failed");
          }
          insertedBilling = data;
        }

        insertedBillingId = insertedBilling.id;

        if (sendWhatsApp) {
          stage = "queue_whatsapp";
          const waStatus = await dispatchBillingWhatsApp({
            supabase,
            student,
            academy,
            billingId: insertedBilling.id,
            planName: plan.name,
            amount: planAmount,
            dueDate,
            boletoUrl: insertedBilling.boleto_url,
          });
          whatsappHandledBillingIds.add(insertedBilling.id);
          if (waStatus === "sent_whatsapp") {
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: insertedBilling.id,
              status: "sent_whatsapp",
            });
          } else if (waStatus === "skipped_missing_whatsapp") {
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: insertedBilling.id,
              status: "generated",
            });
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: insertedBilling.id,
              status: "whatsapp_skipped_missing_recipient",
            });
          } else if (
            waStatus === "whatsapp_skipped_no_boleto" ||
            waStatus === "whatsapp_skipped_sandbox_boleto"
          ) {
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: insertedBilling.id,
              status: "generated",
            });
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: insertedBilling.id,
              status: waStatus,
            });
          } else {
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: insertedBilling.id,
              status: "queued_whatsapp_send_disabled",
            });
          }
        } else {
          processed.push({
            studentId: student.id,
            studentName: student.full_name,
            billingId: insertedBilling.id,
            status: "generated",
          });
        }
      } catch (error) {
        const message = sanitizeBillingError(error instanceof Error ? error.message : "Unknown error");
        console.error("generate-monthly-billings student failed", {
          studentId: student.id,
          studentName: student.full_name,
          academyId: student.academy_id,
          stage,
          message,
        });
        if (insertedBillingId) {
          await supabase.from("billings").update({ status: "falhou", last_error: message }).eq("id", insertedBillingId);
        }
        processed.push(
          buildFailedProcessedEntry({
            studentId: student.id,
            studentName: student.full_name,
            stage,
            error: error instanceof Error ? error.message : message,
            billingId: insertedBillingId,
          }),
        );
      }
    }

    const summary = summarizeBillingProcessed(processed);
    const errors = processed.filter((row) => row.status === "failed");

    return new Response(
      JSON.stringify({
        success: true,
        referenceMonth: runPeriod.referenceMonth,
        dueDate: runPeriod.dueDate,
        dueDay: runPeriod.dueDay,
        referenceLabel: runPeriod.labelPt,
        dueDateLabel: runPeriod.dueDateLabelPt,
        referenceAdjusted,
        force,
        sendWhatsApp: sendWhatsAppOverride ?? null,
        studentId: studentIdFilter,
        summary,
        errors,
        processed,
        whatsappHandledCount: whatsappHandledBillingIds.size,
      }),
      { headers },
    );
  } catch (error) {
    const message = sanitizeBillingError(error instanceof Error ? error.message : "Unknown error");
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return new Response(JSON.stringify({ success: false, error: message }), { status, headers });
  }
});
