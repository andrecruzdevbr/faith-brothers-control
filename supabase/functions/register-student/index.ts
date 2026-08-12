import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient, requireAdmin } from "../_shared/supabase.ts";
import { normalizeWhatsapp, toSyntheticEmail } from "../_shared/phone.ts";
import { isValidTaxId, normalizeTaxId } from "../_shared/tax-id.ts";
import { mapRegisterStudentRpcError } from "../_shared/register-errors.ts";
import {
  dispatchAdminCreatedRegistrationWhatsApp,
  dispatchRegistrationWhatsApp,
} from "../_shared/registration-whatsapp.ts";
import { logSafeError, sanitizeLogError } from "../_shared/sanitize-log.ts";
import { isMinor, validateStudentBirthFields } from "../_shared/student-age.ts";

type FamilyWizardMember = {
  full_name?: string;
  birth_date?: string;
  training_days?: number | null;
  belt?: string | null;
  degrees?: number | null;
  relationship?: string | null;
  guardian_name?: string | null;
  notes?: string | null;
  existing_student_id?: string | null;
};

type RegisterBody = {
  action?: string;
  query?: string;
  full_name?: string;
  whatsapp?: string;
  password?: string;
  academy_id?: string;
  belt?: string | null;
  degrees?: number | null;
  billing_tax_id?: string | null;
  plan_id?: string;
  birth_date?: string;
  guardian_name?: string;
  payment_method?: string | null;
  installments?: number | null;
  registration_audience?: string | null;
  requested_training_days?: number | null;
  contract_type?: string | null;
  family_mode?: string | null;
  family_name?: string | null;
  family_invite_code?: string | null;
  family_relationship?: string | null;
  estimated_member_count?: number | null;
  financial_responsible_name?: string | null;
  financial_responsible_phone?: string | null;
  financial_responsible_email?: string | null;
  responsible_weekly_frequency?: number | null;
  responsible_trains?: boolean | null;
  members?: FamilyWizardMember[] | null;
  /** When true, caller must be academy admin; cadastral approve + single approval WA. */
  admin_created?: boolean;
};

function generateSecurePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function applyAdminCadastralApproval(
  supabase: ReturnType<typeof createServiceClient>,
  studentId: string,
  adminUserId: string,
): Promise<{
  payment_review_status: string | null;
  registration_audience: string | null;
  pending_family_group_id: string | null;
  requested_payment_method: string | null;
  requested_training_days: number | null;
}> {
  const { data: student, error } = await supabase
    .from("students")
    .select(
      "id, status, payment_review_status, registration_audience, pending_family_group_id, requested_payment_method, requested_training_days, approved_at",
    )
    .eq("id", studentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!student) throw new Error("Aluno não encontrado após cadastro");

  if (student.approved_at) {
    return {
      payment_review_status: student.payment_review_status,
      registration_audience: student.registration_audience,
      pending_family_group_id: student.pending_family_group_id,
      requested_payment_method: student.requested_payment_method,
      requested_training_days: student.requested_training_days,
    };
  }

  const audience = student.registration_audience ?? "";
  const review = student.payment_review_status ?? "nao_aplicavel";
  const now = new Date().toISOString();

  if (audience === "veterano") {
    await supabase
      .from("students")
      .update({
        billing_period_status: "aguardando_escolha",
        approved_at: now,
        approved_by: adminUserId,
        updated_at: now,
      })
      .eq("id", studentId)
      .eq("status", "pendente_aprovacao");
  } else if (review === "aguardando_conferencia") {
    await supabase
      .from("students")
      .update({
        approved_at: now,
        approved_by: adminUserId,
        updated_at: now,
      })
      .eq("id", studentId)
      .eq("status", "pendente_aprovacao");

    if (student.pending_family_group_id) {
      await supabase
        .from("students")
        .update({
          approved_at: now,
          approved_by: adminUserId,
          updated_at: now,
        })
        .eq("pending_family_group_id", student.pending_family_group_id)
        .eq("status", "pendente_aprovacao")
        .is("approved_at", null);
    }
  } else {
    await supabase
      .from("students")
      .update({
        status: "ativo",
        approved_at: now,
        approved_by: adminUserId,
        updated_at: now,
      })
      .eq("id", studentId)
      .eq("status", "pendente_aprovacao");
  }

  return {
    payment_review_status: student.payment_review_status,
    registration_audience: student.registration_audience,
    pending_family_group_id: student.pending_family_group_id,
    requested_payment_method: student.requested_payment_method,
    requested_training_days: student.requested_training_days,
  };
}

type RegistrationState = "available" | "complete" | "partial";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

async function findUserByEmail(
  supabase: ReturnType<typeof createServiceClient>,
  email: string,
) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error("Erro ao verificar WhatsApp");
  return data.users.find((user) => user.email === email) ?? null;
}

async function getRegistrationState(
  supabase: ReturnType<typeof createServiceClient>,
  whatsapp: string,
  email: string,
): Promise<RegistrationState> {
  const authUser = await findUserByEmail(supabase, email);

  if (authUser) {
    const { data: linkedStudent } = await supabase
      .from("students")
      .select("id")
      .eq("profile_user_id", authUser.id)
      .maybeSingle();

    return linkedStudent ? "complete" : "partial";
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, whatsapp");

  const profileMatch = profiles?.find(
    (profile) => profile.whatsapp && digitsOnly(profile.whatsapp) === whatsapp,
  );

  const { data: students } = await supabase
    .from("students")
    .select("id, profile_user_id, whatsapp");

  const studentMatch = students?.find(
    (student) => digitsOnly(student.whatsapp) === whatsapp,
  );

  if (studentMatch?.profile_user_id) {
    return "complete";
  }

  if (profileMatch || studentMatch) {
    return "partial";
  }

  return "available";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const body = (await req.json()) as RegisterBody;
    const action = String(body.action ?? "register").trim() || "register";
    const academyIdEarly = String(body.academy_id ?? "").trim();

    if (action === "search_students") {
      const query = String(body.query ?? "").trim();
      if (!academyIdEarly) {
        return new Response(JSON.stringify({ error: "Selecione uma academia." }), {
          status: 400,
          headers,
        });
      }
      const supabaseSearch = createServiceClient();
      const { data, error } = await supabaseSearch.rpc("search_academy_students_for_family", {
        _academy_id: academyIdEarly,
        _query: query,
        _limit: 10,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((row: {
        id: string;
        full_name: string;
        birth_date?: string | null;
        whatsapp: string;
        email: string | null;
        belt?: string | null;
        degrees?: number | null;
        status: string;
      }) => {
        const digits = String(row.whatsapp ?? "").replace(/\D/g, "");
        const email = String(row.email ?? "");
        return {
          id: row.id,
          full_name: row.full_name,
          birth_date: row.birth_date ?? null,
          whatsapp_masked: digits.length >= 4 ? `*******${digits.slice(-4)}` : "—",
          email_masked: email.includes("@")
            ? `${email.slice(0, 2)}***@${email.split("@")[1]}`
            : email || null,
          belt: row.belt ?? null,
          degrees: row.degrees ?? null,
          status: row.status,
        };
      });
      return new Response(JSON.stringify({ students: rows }), { headers });
    }

    const fullName = String(body.full_name ?? "").trim();
    const whatsapp = normalizeWhatsapp(String(body.whatsapp ?? ""));
    const adminCreated = body.admin_created === true;
    let adminUserId: string | null = null;
    if (adminCreated) {
      const authHeader = req.headers.get("Authorization") ?? "";
      try {
        const admin = await requireAdmin(authHeader);
        adminUserId = admin.userId;
        const { data: profile } = await admin.supabase
          .from("profiles")
          .select("academy_id")
          .eq("user_id", admin.userId)
          .maybeSingle();
        if (!profile?.academy_id || profile.academy_id !== academyIdEarly) {
          return new Response(JSON.stringify({ error: "Academia não autorizada para este administrador." }), {
            status: 403,
            headers,
          });
        }
      } catch (authErr) {
        const msg = authErr instanceof Error ? authErr.message : "Unauthorized";
        const status = msg === "Forbidden" ? 403 : 401;
        return new Response(JSON.stringify({ error: "Somente administrador pode cadastrar aluno pelo painel." }), {
          status,
          headers,
        });
      }
    }
    const password = adminCreated
      ? (String(body.password ?? "").trim().length >= 8
          ? String(body.password).trim()
          : generateSecurePassword())
      : String(body.password ?? "");
    const academyId = academyIdEarly;
    const belt = String(body.belt ?? "Branca").trim() || "Branca";
    // Public registration collects belt only; degrees stay 0 until ADM updates.
    const degrees = 0;
    const rawTaxId = body.billing_tax_id == null ? "" : String(body.billing_tax_id);
    const billingTaxId = rawTaxId ? normalizeTaxId(rawTaxId) : "";
    const planId = String(body.plan_id ?? "").trim();
    const birthDate = String(body.birth_date ?? "").trim();
    const guardianName = String(body.guardian_name ?? "").trim();
    const paymentMethod = body.payment_method ? String(body.payment_method).trim() : null;
    const installments =
      body.installments == null || body.installments === undefined
        ? null
        : Number(body.installments);
    const registrationAudience = body.registration_audience
      ? String(body.registration_audience).trim()
      : null;
    const requestedTrainingDays =
      body.requested_training_days == null || body.requested_training_days === undefined
        ? null
        : Number(body.requested_training_days);
    const isVeteran = registrationAudience === "veterano";
    const contractType = String(body.contract_type ?? "individual").trim() || "individual";
    const familyMode = body.family_mode ? String(body.family_mode).trim() : null;
    const familyName = body.family_name ? String(body.family_name).trim() : null;
    const familyInviteCode = body.family_invite_code
      ? String(body.family_invite_code).trim().toUpperCase()
      : null;
    const familyRelationship = body.family_relationship
      ? String(body.family_relationship).trim()
      : "integrante";
    const estimatedMemberCount =
      body.estimated_member_count == null ? null : Number(body.estimated_member_count);
    const financialResponsibleName = body.financial_responsible_name
      ? String(body.financial_responsible_name).trim()
      : null;
    const financialResponsiblePhone = body.financial_responsible_phone
      ? String(body.financial_responsible_phone).trim()
      : null;
    const financialResponsibleEmail = body.financial_responsible_email
      ? String(body.financial_responsible_email).trim()
      : null;
    const responsibleWeeklyFrequency =
      body.responsible_weekly_frequency == null
        ? null
        : Number(body.responsible_weekly_frequency);
    const responsibleTrains = body.responsible_trains !== false;
    const wizardMembers = Array.isArray(body.members)
      ? body.members.map((m) => {
          const birth = String(m.birth_date ?? "").trim();
          const minor = birth ? isMinor(birth) : false;
          return {
            ...m,
            degrees: 0,
            // Family holder is the legal guardian of minor dependents (ignore client value).
            guardian_name: minor ? financialResponsibleName || fullName : null,
          };
        })
      : [];
    const isFamilyWizard = contractType === "familiar" && familyMode === "wizard";
    const joiningFamily = contractType === "familiar" && familyMode === "join";

    if (!/^\d{11}$/.test(whatsapp)) {
      return new Response(
        JSON.stringify({ error: "WhatsApp inválido. Informe 11 dígitos com DDD." }),
        { status: 400, headers },
      );
    }

    if (fullName.length < 3) {
      return new Response(JSON.stringify({ error: "Informe seu nome completo." }), {
        status: 400,
        headers,
      });
    }

    const birthError = validateStudentBirthFields({
      birthDate,
      guardianName,
    });
    if (birthError) {
      return new Response(JSON.stringify({ error: birthError }), { status: 400, headers });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "A senha precisa ter pelo menos 8 caracteres." }), {
        status: 400,
        headers,
      });
    }

    if (isFamilyWizard || (!joiningFamily && !isValidTaxId(billingTaxId))) {
      if (!isValidTaxId(billingTaxId)) {
        return new Response(
          JSON.stringify({
            error: "CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).",
          }),
          { status: 400, headers },
        );
      }
    }
    if (joiningFamily && billingTaxId && !isValidTaxId(billingTaxId)) {
      return new Response(JSON.stringify({ error: "CPF ou CNPJ inválido." }), {
        status: 400,
        headers,
      });
    }

    if (isFamilyWizard) {
      if (wizardMembers.length < 1) {
        return new Response(
          JSON.stringify({
            error: responsibleTrains
              ? "Inclua ao menos um integrante além do responsável."
              : "Quando o responsável não treina, adicione ao menos um integrante.",
          }),
          { status: 400, headers },
        );
      }
      if (responsibleTrains && (degrees < 0 || degrees > 4 || !Number.isInteger(degrees))) {
        return new Response(
          JSON.stringify({ error: "Quantidade de graus do responsável inválida (0 a 4)." }),
          { status: 400, headers },
        );
      }
    }

    if (!academyId) {
      return new Response(JSON.stringify({ error: "Selecione uma academia." }), {
        status: 400,
        headers,
      });
    }

    if (isVeteran) {
      if (requestedTrainingDays !== 1 && requestedTrainingDays !== 2 && requestedTrainingDays !== 3 && requestedTrainingDays !== 5) {
        return new Response(
          JSON.stringify({ error: "Veterano: escolha 1, 2, 3 ou 5 dias por semana." }),
          { status: 400, headers },
        );
      }
    } else if (!planId && !isFamilyWizard) {
      return new Response(JSON.stringify({ error: "Selecione um plano desejado." }), {
        status: 400,
        headers,
      });
    }

    const supabase = createServiceClient();

    const { data: academy, error: academyError } = await supabase
      .from("academies")
      .select("id")
      .eq("id", academyId)
      .maybeSingle();

    if (academyError) throw new Error(academyError.message);
    if (!academy) {
      return new Response(JSON.stringify({ error: "Academia inválida." }), { status: 400, headers });
    }

    let billingMode = "asaas_monthly";
    if (!isVeteran && planId) {
      const { data: plan, error: planError } = await supabase
        .from("plans")
        .select("id, billing_mode, allows_installments, max_installments")
        .eq("id", planId)
        .eq("academy_id", academyId)
        .eq("active", true)
        .maybeSingle();

      if (planError) throw new Error(planError.message);
      if (!plan) {
        return new Response(
          JSON.stringify({
            error: "Plano inválido ou inativo. Cadastre um plano ativo antes de vincular.",
          }),
          { status: 400, headers },
        );
      }

      billingMode = String((plan as { billing_mode?: string }).billing_mode ?? "asaas_monthly");
      const machinePlan = billingMode === "machine_prepaid" || billingMode === "machine_dropin";
      const newStudentCard =
        (registrationAudience === "new_student" || !registrationAudience) &&
        !machinePlan &&
        !!paymentMethod &&
        paymentMethod !== "boleto";

      if (machinePlan) {
        if (
          !paymentMethod ||
          !["cartao_credito", "cartao_debito", "pix", "dinheiro"].includes(paymentMethod)
        ) {
          return new Response(JSON.stringify({ error: "Informe a forma de pagamento do pacote." }), {
            status: 400,
            headers,
          });
        }
      } else if (registrationAudience === "new_student" || !registrationAudience) {
        if (
          !paymentMethod ||
          !["boleto", "cartao_credito", "cartao_debito", "pix", "dinheiro"].includes(paymentMethod)
        ) {
          return new Response(
            JSON.stringify({ error: "Informe a forma de pagamento (boleto ou maquininha)." }),
            { status: 400, headers },
          );
        }
      }

      // Card/machine intent is never auto-paid — validated again in RPC.
      void newStudentCard;
    }

    const email = toSyntheticEmail(whatsapp);
    const registrationState = await getRegistrationState(supabase, whatsapp, email);

    if (registrationState === "complete") {
      return new Response(
        JSON.stringify({ error: "Este WhatsApp já está cadastrado." }),
        { status: 409, headers },
      );
    }

    if (registrationState === "partial") {
      return new Response(
        JSON.stringify({
          error:
            "Cadastro incompleto para este WhatsApp. Entre em contato com a administração da academia para concluir o vínculo.",
        }),
        { status: 409, headers },
      );
    }

    if (billingTaxId) {
      const { data: taxDuplicate } = await supabase
        .from("student_billing_profiles")
        .select("student_id")
        .eq("tax_id", billingTaxId)
        .maybeSingle();

      if (taxDuplicate) {
        return new Response(
          JSON.stringify({ error: "Este CPF/CNPJ já está cadastrado." }),
          { status: 409, headers },
        );
      }
    }

    let createdUserId: string | null = null;

    try {
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          whatsapp,
          academy_id: academyId,
          belt,
        },
      });

      if (createError) {
        const message = createError.message.toLowerCase();
        if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
          return new Response(
            JSON.stringify({ error: "Este WhatsApp já está cadastrado." }),
            { status: 409, headers },
          );
        }
        throw new Error(createError.message);
      }

      createdUserId = newUser.user.id;

      if (isFamilyWizard) {
        const { data: wizardResult, error: wizardError } = await supabase.rpc(
          "register_family_wizard_atomic",
          {
            _user_id: createdUserId,
            _academy_id: academyId,
            _full_name: fullName,
            _whatsapp: whatsapp,
            _belt: responsibleTrains ? belt : "Branca",
            _degrees: responsibleTrains ? degrees : 0,
            _tax_id: billingTaxId || null,
            _plan_id: planId,
            _birth_date: birthDate,
            _guardian_name: guardianName || null,
            _payment_method: paymentMethod,
            _installments: Number.isFinite(installments as number) ? installments : null,
            _family_name: familyName,
            _financial_responsible_email: financialResponsibleEmail,
            _responsible_weekly_frequency: responsibleTrains &&
                Number.isFinite(responsibleWeeklyFrequency as number)
              ? responsibleWeeklyFrequency
              : null,
            _responsible_trains: responsibleTrains,
            _members: wizardMembers,
          },
        );

        if (wizardError) {
          logSafeError(
            "register-student family wizard RPC failed",
            { userId: createdUserId, whatsapp, academyId },
            wizardError,
          );
          const rpcMessage =
            wizardError && typeof wizardError === "object" && "message" in wizardError
              ? String((wizardError as { message: unknown }).message ?? "Falha no cadastro familiar")
              : "Falha no cadastro familiar";
          throw new Error(rpcMessage);
        }

        const result = wizardResult as {
          responsible_student_id?: string | null;
          family_group_id?: string;
          member_count?: number;
          member_student_ids?: string[];
        } | null;

        if (!result?.family_group_id || !result.member_count) {
          throw new Error("Não foi possível criar o cadastro familiar");
        }

        const notifyStudentId =
          result.responsible_student_id ||
          (Array.isArray(result.member_student_ids) ? result.member_student_ids[0] : null) ||
          null;

        let whatsappInfo;
        if (adminCreated && adminUserId && notifyStudentId) {
          const approvalMeta = await applyAdminCadastralApproval(
            supabase,
            String(notifyStudentId),
            adminUserId,
          );
          whatsappInfo = await dispatchAdminCreatedRegistrationWhatsApp({
            supabase,
            academyId,
            studentId: String(notifyStudentId),
            fullName,
            whatsapp,
            registrationAudience: approvalMeta.registration_audience,
            paymentReviewStatus: approvalMeta.payment_review_status,
            pendingFamilyGroupId: approvalMeta.pending_family_group_id,
            requestedPaymentMethod: approvalMeta.requested_payment_method,
            requestedTrainingDays: approvalMeta.requested_training_days,
          });
        } else {
          whatsappInfo = await dispatchRegistrationWhatsApp({
            supabase,
            academyId,
            studentId: notifyStudentId,
            fullName,
            whatsapp,
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: adminCreated
              ? "Família cadastrada e aprovada cadastralmente. Pagamento (se houver) continua em etapa separada. O aluno acessa com “Esqueci minha senha”."
              : "Cadastro familiar enviado. Aguarde a academia confirmar o pagamento. Nenhum boleto é gerado no cadastro.",
            email,
            student_id: result.responsible_student_id ?? null,
            family_group_id: result.family_group_id,
            member_count: result.member_count,
            admin_created: adminCreated,
            whatsapp: whatsappInfo,
          }),
          { headers },
        );
      }

      const { data: studentId, error: rpcError } = await supabase.rpc(
        "complete_student_registration_atomic",
        {
          _user_id: createdUserId,
          _academy_id: academyId,
          _full_name: fullName,
          _whatsapp: whatsapp,
          _belt: belt,
          _tax_id: billingTaxId || null,
          _plan_id: isVeteran ? null : planId || null,
          _birth_date: birthDate,
          _guardian_name: guardianName || null,
          _payment_method: isVeteran ? null : paymentMethod,
          _installments:
            isVeteran || !Number.isFinite(installments as number) ? null : installments,
          _contract_type: contractType,
          _family_mode: familyMode,
          _family_name: familyName,
          _family_invite_code: familyInviteCode,
          _family_relationship: familyRelationship,
          _estimated_member_count: Number.isFinite(estimatedMemberCount as number)
            ? estimatedMemberCount
            : null,
          _financial_responsible_name: financialResponsibleName,
          _financial_responsible_phone: financialResponsiblePhone,
          _financial_responsible_email: financialResponsibleEmail,
          _registration_audience: isVeteran
            ? "veterano"
            : registrationAudience === "new_student" || !registrationAudience
              ? "new_student"
              : registrationAudience,
          _requested_training_days: isVeteran ? requestedTrainingDays : null,
        },
      );

      if (rpcError) {
        logSafeError(
          "register-student RPC failed",
          { userId: createdUserId, whatsapp, academyId },
          rpcError,
        );
        throw rpcError;
      }

      if (!studentId) {
        throw new Error("Não foi possível criar o registro do aluno");
      }

      let whatsappInfo;
      if (adminCreated && adminUserId) {
        const approvalMeta = await applyAdminCadastralApproval(
          supabase,
          String(studentId),
          adminUserId,
        );
        whatsappInfo = await dispatchAdminCreatedRegistrationWhatsApp({
          supabase,
          academyId,
          studentId: String(studentId),
          fullName,
          whatsapp,
          registrationAudience: approvalMeta.registration_audience ?? registrationAudience,
          paymentReviewStatus: approvalMeta.payment_review_status,
          pendingFamilyGroupId: approvalMeta.pending_family_group_id,
          requestedPaymentMethod: approvalMeta.requested_payment_method ?? paymentMethod,
          requestedTrainingDays:
            approvalMeta.requested_training_days ?? requestedTrainingDays,
        });
      } else {
        whatsappInfo = await dispatchRegistrationWhatsApp({
          supabase,
          academyId,
          studentId: String(studentId),
          fullName,
          whatsapp,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: adminCreated
            ? "Aluno cadastrado e aprovado cadastralmente. Pagamento (se houver) continua em etapa separada. Acesso: “Esqueci minha senha”."
            : "Cadastro realizado. Aguarde a aprovação da academia.",
          email,
          student_id: studentId,
          admin_created: adminCreated,
          whatsapp: whatsappInfo,
        }),
        { headers },
      );
    } catch (error) {
      if (createdUserId) {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(createdUserId);
        if (deleteError) {
          logSafeError(
            "register-student rollback failed",
            { userId: createdUserId, whatsapp },
            deleteError,
          );
        }
      }

      const message =
        error instanceof Error
          ? error.message
          : error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Erro desconhecido";
      const mapped = mapRegisterStudentRpcError(message);
      return new Response(JSON.stringify({ error: mapped.error }), { status: mapped.status, headers });
    }
  } catch (error) {
    logSafeError("register-student unexpected error", {}, error);
    return new Response(JSON.stringify({ error: sanitizeLogError(error) }), { status: 500, headers });
  }
});
