import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";
import { getEnv } from "../_shared/env.ts";
import { queueWhatsApp } from "../_shared/whatsapp.ts";
import {
  type AcademyBillingSettings,
  type BillingProcessedEntry,
  DEFAULT_BOLETO_DUE_DAY,
  DEFAULT_BOLETO_ISSUE_DAY,
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
  BILLING_GENERATION_CLAIM_MARKER,
  asaasPaymentListHasMore,
  buildAsaasPaymentsLookupPath,
  buildAsaasPaymentIdempotencyKey,
  buildExternalReference,
  buildFailedProcessedEntry,
  decideBillingGenerationAction,
  getAsaasPaymentFields,
  isBillingUniqueViolation,
  pickExistingAsaasPayment,
  shouldCreateAsaasPayment,
  shouldUpdateAsaasCustomer,
  unwrapRelation,
} from "../_shared/asaas-billing.ts";
import { timingSafeEqualString } from "../_shared/timing-safe.ts";
import { normalizeTaxId, sanitizeBillingError } from "../_shared/tax-id.ts";
import { assertSendableBoletoUrl } from "../_shared/billing-boleto.ts";
import {
  buildAsaasBoletoPaymentPayload,
  buildBillingIssuedIdempotencyKey,
  buildMonthlyBoletoWhatsAppMessage,
  preferBankSlipUrl,
  evaluateAutomaticMonthlyBoleto,
  resolveFinancialNoticeRecipient,
  resolveMonthlyBillingWhatsAppRecipient,
  shouldDispatchBillingWhatsApp,
} from "../_shared/asaas-monthly-boleto.ts";
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
  requested_payment_method?: string | null;
  payment_review_status?: string | null;
  status?: string | null;
  plans: PlanEmbed | PlanEmbed[] | null;
  student_billing_profiles:
    | StudentBillingProfile
    | StudentBillingProfile[]
    | null;
  academies: AcademyEmbed | AcademyEmbed[] | null;
};

type FamilyResponsible = {
  phone: string | null;
  responsibleStudentId: string | null;
};

type GenerateBody = {
  studentId?: string;
  student_id?: string;
  force?: boolean;
  sendWhatsApp?: boolean;
  /** YYYY-MM-01 ou YYYY-MM — se omitido, usa próxima referência válida (dia 15). */
  referenceMonth?: string;
  /** No Asaas create, no local claim, no WhatsApp. */
  dryRun?: boolean;
};

const ASAAS_FETCH_TIMEOUT_MS = 25_000;

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASAAS_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "FaithBrothersHub/1.0",
        access_token: apiKey,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    const aborted =
      (error instanceof Error && error.name === "AbortError") ||
      (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
    if (aborted) {
      throw new Error(`Asaas timeout after ${ASAAS_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

async function findExistingAsaasPaymentByReference(
  externalReference: string,
): Promise<Record<string, unknown> | null> {
  const collected: Array<Record<string, unknown>> = [];
  let offset = 0;
  for (let page = 0; page < 10; page++) {
    const response = await asaasRequest(buildAsaasPaymentsLookupPath(externalReference, offset));
    const rows = Array.isArray(response.data) ? response.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object") : [];
    collected.push(...rows);
    if (!asaasPaymentListHasMore(response) || rows.length === 0) break;
    offset += rows.length;
  }
  return pickExistingAsaasPayment({ data: collected });
}

async function loadFamilyResponsibleMap(
  supabase: ReturnType<typeof createServiceClient>,
  studentIds: string[],
): Promise<Map<string, FamilyResponsible>> {
  const map = new Map<string, FamilyResponsible>();
  if (studentIds.length === 0) return map;
  const { data, error } = await supabase
    .from("family_members")
    .select("student_id, family_groups ( financial_responsible_phone, financial_responsible_student_id )")
    .in("student_id", studentIds)
    .eq("status", "ativo");
  if (error || !data) return map;
  for (const row of data as Array<{
    student_id: string;
    family_groups:
      | {
          financial_responsible_phone: string | null;
          financial_responsible_student_id: string | null;
        }
      | {
          financial_responsible_phone: string | null;
          financial_responsible_student_id: string | null;
        }[]
      | null;
  }>) {
    const group = unwrapRelation(row.family_groups);
    map.set(row.student_id, {
      phone: group?.financial_responsible_phone ?? null,
      responsibleStudentId: group?.financial_responsible_student_id ?? null,
    });
  }
  return map;
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
  recipient: string;
}): Promise<
  | "sent_whatsapp"
  | "queued_whatsapp_send_disabled"
  | "skipped_missing_whatsapp"
  | "whatsapp_skipped_no_boleto"
  | "whatsapp_skipped_sandbox_boleto"
> {
  if (!hasValidStudentWhatsapp(params.recipient)) {
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
    recipient: params.recipient,
    body: buildMonthlyBoletoWhatsAppMessage({
      academyName: params.academy?.name ?? "Faith Brothers BJJ",
      studentName: params.student.full_name,
      planName: params.planName,
      amount: params.amount,
      dueDate: params.dueDate,
      bankSlipUrl: boletoCheck.url,
      financeContact: params.academy?.finance_contact_name ?? "Financeiro",
      financeWhatsapp: params.academy?.finance_whatsapp ?? "",
    }),
    messageType: "billing",
    idempotencyKey: buildBillingIssuedIdempotencyKey(params.billingId),
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
    const authHeader = req.headers.get("Authorization");
    const cronSecret = getEnv("BILLING_CRON_SECRET");
    const isCronCall = timingSafeEqualString(req.headers.get("x-cron-secret"), cronSecret);
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
    const dryRun = body.dryRun === true;
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

    if (!dryRun) {
      getAsaasBaseUrl();
      getEnv("ASAAS_API_KEY");
    }

    const supabase = createServiceClient();
    if (!dryRun) {
      try {
        await supabase.rpc("expire_elapsed_student_contracts");
      } catch (expireError) {
        console.error("expire_elapsed_student_contracts skipped", {
          message: expireError instanceof Error ? expireError.message : String(expireError),
        });
      }
    }
    const now = new Date();
    const today = getBrazilCivilDate(now).day;

    // Período padrão (dia 15). Pode ser sobrescrito por aluno se settings diferirem.
    const defaultPeriodResult = resolveBillingPeriod({
      now,
      dueDay: DEFAULT_BOLETO_DUE_DAY,
      issueDay: DEFAULT_BOLETO_ISSUE_DAY,
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
        id, academy_id, full_name, email, whatsapp, asaas_customer_id, plan_id, requested_payment_method, payment_review_status, status,
        student_billing_profiles ( tax_id ),
        plans ( id, name, monthly_price, billing_mode ),
        academies!inner ( name, finance_contact_name, finance_whatsapp,
          academy_billing_settings ( boleto_issue_day, boleto_due_day, send_whatsapp_automatically )
        )
      `)
      .eq("status", "ativo")
      .eq("requested_payment_method", "boleto")
      .not("plan_id", "is", null);

    if (academyIdFilter) studentsQuery = studentsQuery.eq("academy_id", academyIdFilter);
    if (studentIdFilter) studentsQuery = studentsQuery.eq("id", studentIdFilter);

    const { data: students, error: studentsError } = await studentsQuery;
    if (studentsError) throw new Error(studentsError.message);

    const processed: BillingProcessedEntry[] = [];
    const whatsappHandledBillingIds = new Set<string>();
    const familyByStudentId = await loadFamilyResponsibleMap(
      supabase,
      ((students ?? []) as unknown as StudentRow[]).map((row) => row.id),
    );

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
        const { data: skipReason, error: skipError } = await supabase.rpc("prepaid_cron_skip_reason", {
          _student_id: student.id,
          _reference_month: period.referenceMonth,
        });
        if (skipError) {
          processed.push(
            buildFailedProcessedEntry({
              studentId: student.id,
              studentName: student.full_name,
              stage: "resolve_student",
              error: "prepaid_cron_skip_reason indisponivel; cobranca adiada",
            }),
          );
          continue;
        }
        if (typeof skipReason === "string" && skipReason.length > 0) {
          processed.push({
            studentId: student.id,
            studentName: student.full_name,
            status: skipReason as BillingProcessedEntry["status"],
          });
          continue;
        }
        if (skipReason != null && skipReason !== "") {
          processed.push(
            buildFailedProcessedEntry({
              studentId: student.id,
              studentName: student.full_name,
              stage: "resolve_student",
              error: "prepaid_cron_skip_reason resposta inesperada; cobranca adiada",
            }),
          );
          continue;
        }
      } catch {
        processed.push(
          buildFailedProcessedEntry({
            studentId: student.id,
            studentName: student.full_name,
            stage: "resolve_student",
            error: "prepaid_cron_skip_reason falhou; cobranca adiada",
          }),
        );
        continue;
      }

      const boletoGate = evaluateAutomaticMonthlyBoleto({
        status: student.status ?? "ativo",
        requestedPaymentMethod: student.requested_payment_method,
        billingMode: plan.billing_mode,
        paymentReviewStatus: student.payment_review_status,
        monthlyPrice: Number(plan.monthly_price),
      });
      if (!boletoGate.eligible) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: boletoGate.reason as BillingProcessedEntry["status"],
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

      const family = familyByStudentId.get(student.id);
      const recipientInput = {
        studentId: student.id,
        studentWhatsapp: student.whatsapp,
        responsibleStudentId: family?.responsibleStudentId,
        responsiblePhone: family?.phone,
      };
      const noticeRecipient = resolveFinancialNoticeRecipient(recipientInput).recipient;
      const fallbackRecipient = resolveMonthlyBillingWhatsAppRecipient(recipientInput).recipient;
      const billingRecipient = hasValidStudentWhatsapp(noticeRecipient)
        ? noticeRecipient
        : family?.responsibleStudentId
          ? ""
          : fallbackRecipient;

      if (!hasValidStudentWhatsapp(noticeRecipient) && !hasValidStudentWhatsapp(fallbackRecipient)) {
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

      const loadExistingBilling = async () => {
        const { data } = await supabase
          .from("billings")
          .select(
            "id, status, boleto_url, amount, due_date, plan_id, asaas_payment_id, updated_at, last_error, plans(name)",
          )
          .eq("student_id", student.id)
          .eq("reference_month", period.referenceMonth)
          .maybeSingle();
        return data;
      };

      let existingBilling = await loadExistingBilling();
      let decision = decideBillingGenerationAction(existingBilling, now);

      if (decision.action === "already_exists" && existingBilling) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          billingId: existingBilling.id,
          status: "already_exists",
        });

        if (
          !dryRun &&
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
            recipient: billingRecipient,
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

      if (decision.action === "in_progress" && existingBilling) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          billingId: existingBilling.id,
          status: "generation_in_progress",
        });
        continue;
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

      const dueDate = period.dueDate;
      const issueDate = period.issueDate;

      if (dryRun) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: "dry_run_eligible",
          amount: planAmount,
          dueDate,
          referenceMonth: period.referenceMonth,
        });
        continue;
      }

      let claimedBillingId: string | null =
        decision.action === "complete_claimed" || decision.action === "reprocess_failed"
          ? decision.billingId
          : null;

      // Claim the UNIQUE (student_id, reference_month) slot BEFORE any Asaas create.
      if (decision.action === "create_claim") {
        const { data: claimed, error: claimError } = await supabase
          .from("billings")
          .insert({
            academy_id: student.academy_id,
            student_id: student.id,
            plan_id: plan.id,
            reference_month: period.referenceMonth,
            amount: planAmount,
            issue_date: issueDate,
            due_date: dueDate,
            status: "pendente",
            asaas_payment_id: null,
            boleto_url: null,
            invoice_number: null,
            last_error: BILLING_GENERATION_CLAIM_MARKER,
          })
          .select("id")
          .single();

        if (claimError || !claimed) {
          if (!isBillingUniqueViolation(claimError)) {
            throw new Error(claimError?.message ?? "billing claim failed");
          }
          existingBilling = await loadExistingBilling();
          decision = decideBillingGenerationAction(existingBilling, now);
          if (decision.action === "already_exists" || decision.action === "in_progress") {
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              billingId: existingBilling?.id,
              status: decision.action === "in_progress" ? "generation_in_progress" : "already_exists",
            });
            continue;
          }
          if (decision.action === "complete_claimed" || decision.action === "reprocess_failed") {
            claimedBillingId = decision.billingId;
          } else {
            processed.push({
              studentId: student.id,
              studentName: student.full_name,
              status: "already_exists",
            });
            continue;
          }
        } else {
          claimedBillingId = claimed.id;
        }
      }

      if (!claimedBillingId) {
        processed.push({
          studentId: student.id,
          studentName: student.full_name,
          status: "already_exists",
        });
        continue;
      }

      let insertedBillingId: string | undefined = claimedBillingId;
      let stage: BillingProcessStage = "ensure_customer";
      try {
        const customerId = await ensureAsaasCustomer(supabase, student, taxId, (next) => {
          stage = next;
        });
        const externalReference = buildExternalReference(student.id, period.referenceMonth);

        stage = "find_existing_asaas_payment";
        let paymentRecord = await findExistingAsaasPaymentByReference(externalReference);

        if (shouldCreateAsaasPayment(paymentRecord)) {
          stage = "create_asaas_payment";
          try {
            paymentRecord = await asaasRequest("/payments", {
              method: "POST",
              headers: {
                "Idempotency-Key": buildAsaasPaymentIdempotencyKey(student.id, period.referenceMonth),
              },
              body: JSON.stringify(
                buildAsaasBoletoPaymentPayload({
                  customerId,
                  value: planAmount,
                  dueDate,
                  description: `${academy?.name ?? "Academia"} - ${plan.name} - ${period.referenceMonth}`,
                  externalReference,
                }),
              ),
            });
          } catch (createError) {
            const recovered = await findExistingAsaasPaymentByReference(externalReference);
            if (!shouldCreateAsaasPayment(recovered) && recovered) {
              paymentRecord = recovered;
            } else {
              throw createError;
            }
          }
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
          boleto_url: preferBankSlipUrl(paymentRecord),
          invoice_number: payment.invoiceNumber,
          last_error: null as string | null,
        };

        const { data: insertedBilling, error: billingUpdateError } = await supabase
          .from("billings")
          .update(billingPayload)
          .eq("id", claimedBillingId)
          .select("id, boleto_url")
          .single();
        if (billingUpdateError || !insertedBilling) {
          throw new Error(billingUpdateError?.message ?? "update failed");
        }

        insertedBillingId = insertedBilling.id;

        if (
          shouldDispatchBillingWhatsApp({
            sendWhatsApp,
            asaasPaymentId: payment.id,
          })
        ) {
          stage = "queue_whatsapp";
          try {
            const waStatus = await dispatchBillingWhatsApp({
              supabase,
              student,
              academy,
              billingId: insertedBilling.id,
              planName: plan.name,
              amount: planAmount,
              dueDate,
              boletoUrl: insertedBilling.boleto_url,
              recipient: billingRecipient,
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
          } catch (whatsappError) {
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
              status: "whatsapp_failed",
              error: sanitizeBillingError(
                whatsappError instanceof Error ? whatsappError.message : "WhatsApp send failed",
              ),
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
        dryRun,
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
