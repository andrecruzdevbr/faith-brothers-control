import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { normalizeWhatsapp, toSyntheticEmail } from "../_shared/phone.ts";
import { isValidTaxId, normalizeTaxId } from "../_shared/tax-id.ts";
import { mapRegisterStudentRpcError } from "../_shared/register-errors.ts";
import { dispatchRegistrationWhatsApp } from "../_shared/registration-whatsapp.ts";
import { logSafeError, sanitizeLogError } from "../_shared/sanitize-log.ts";
import { validateStudentBirthFields } from "../_shared/student-age.ts";

type RegisterBody = {
  full_name?: string;
  whatsapp?: string;
  password?: string;
  academy_id?: string;
  belt?: string;
  billing_tax_id?: string | null;
  plan_id?: string;
  birth_date?: string;
  guardian_name?: string;
  payment_method?: string | null;
  installments?: number | null;
  contract_type?: string | null;
  family_mode?: string | null;
  family_name?: string | null;
  family_invite_code?: string | null;
  family_relationship?: string | null;
  estimated_member_count?: number | null;
  financial_responsible_name?: string | null;
  financial_responsible_phone?: string | null;
  financial_responsible_email?: string | null;
};

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
    const fullName = String(body.full_name ?? "").trim();
    const whatsapp = normalizeWhatsapp(String(body.whatsapp ?? ""));
    const password = String(body.password ?? "");
    const academyId = String(body.academy_id ?? "");
    const belt = String(body.belt ?? "Branca").trim() || "Branca";
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

    if (!joiningFamily && !isValidTaxId(billingTaxId)) {
      return new Response(
        JSON.stringify({ error: "CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ)." }),
        { status: 400, headers },
      );
    }
    if (joiningFamily && billingTaxId && !isValidTaxId(billingTaxId)) {
      return new Response(JSON.stringify({ error: "CPF ou CNPJ inválido." }), {
        status: 400,
        headers,
      });
    }

    if (!academyId) {
      return new Response(JSON.stringify({ error: "Selecione uma academia." }), {
        status: 400,
        headers,
      });
    }

    if (!planId) {
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
        JSON.stringify({ error: "Plano inválido ou inativo. Cadastre um plano ativo antes de vincular." }),
        { status: 400, headers },
      );
    }

    const billingMode = String((plan as { billing_mode?: string }).billing_mode ?? "asaas_monthly");
    if (
      (billingMode === "machine_prepaid" || billingMode === "machine_dropin") &&
      (!paymentMethod ||
        !["cartao_credito", "cartao_debito", "pix", "dinheiro"].includes(paymentMethod))
    ) {
      return new Response(JSON.stringify({ error: "Informe a forma de pagamento do pacote." }), {
        status: 400,
        headers,
      });
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

      const { data: studentId, error: rpcError } = await supabase.rpc(
        "complete_student_registration_atomic",
        {
          _user_id: createdUserId,
          _academy_id: academyId,
          _full_name: fullName,
          _whatsapp: whatsapp,
          _belt: belt,
          _tax_id: billingTaxId || null,
          _plan_id: planId,
          _birth_date: birthDate,
          _guardian_name: guardianName || null,
          _payment_method: paymentMethod,
          _installments: Number.isFinite(installments as number) ? installments : null,
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

      const whatsappInfo = await dispatchRegistrationWhatsApp({
        supabase,
        academyId,
        studentId: String(studentId),
        fullName,
        whatsapp,
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "Cadastro realizado. Aguarde a aprovação da academia.",
          email,
          student_id: studentId,
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

      const message = error instanceof Error ? error.message : "Erro desconhecido";
      const mapped = mapRegisterStudentRpcError(message);
      return new Response(JSON.stringify({ error: mapped.error }), { status: mapped.status, headers });
    }
  } catch (error) {
    logSafeError("register-student unexpected error", {}, error);
    return new Response(JSON.stringify({ error: sanitizeLogError(error) }), { status: 500, headers });
  }
});
