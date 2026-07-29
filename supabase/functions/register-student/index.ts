import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { normalizeWhatsapp, toSyntheticEmail } from "../_shared/phone.ts";
import { isValidTaxId, normalizeTaxId } from "../_shared/tax-id.ts";
import { mapRegisterStudentRpcError } from "../_shared/register-errors.ts";
import { dispatchRegistrationWhatsApp } from "../_shared/registration-whatsapp.ts";
import { logSafeError, sanitizeLogError } from "../_shared/sanitize-log.ts";

type RegisterBody = {
  full_name?: string;
  whatsapp?: string;
  password?: string;
  academy_id?: string;
  belt?: string;
  billing_tax_id?: string;
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
    const billingTaxId = normalizeTaxId(String(body.billing_tax_id ?? ""));

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

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: "A senha precisa ter pelo menos 8 caracteres." }), {
        status: 400,
        headers,
      });
    }

    if (!isValidTaxId(billingTaxId)) {
      return new Response(
        JSON.stringify({ error: "CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ)." }),
        { status: 400, headers },
      );
    }

    if (!academyId) {
      return new Response(JSON.stringify({ error: "Selecione uma academia." }), {
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
          _tax_id: billingTaxId,
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
