import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { normalizeWhatsapp, toSyntheticEmail } from "../_shared/phone.ts";
import { getEnvOptional } from "../_shared/env.ts";

type StaffMember = { name: string; whatsapp: string; roles: ("admin" | "professor")[] };

function parseStaffSeed(): StaffMember[] {
  const raw = getEnvOptional("STAFF_SEED_JSON");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StaffMember[];
  } catch {
    throw new Error("STAFF_SEED_JSON inválido");
  }
}

async function ensureUser(
  supabase: ReturnType<typeof createServiceClient>,
  academyId: string,
  person: StaffMember,
  password: string,
) {
  const email = toSyntheticEmail(person.whatsapp);
  const { data: usersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = usersData?.users?.find((u) => u.email === email);

  let userId: string;
  if (existing) {
    userId = existing.id;
    await supabase.auth.admin.updateUserById(userId, { password });
  } else {
    const { data: newUser, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: person.name, whatsapp: normalizeWhatsapp(person.whatsapp) },
    });
    if (error) throw new Error(error.message);
    userId = newUser.user.id;
  }

  await supabase.from("profiles").upsert(
    {
      user_id: userId,
      academy_id: academyId,
      full_name: person.name,
      whatsapp: normalizeWhatsapp(person.whatsapp),
    },
    { onConflict: "user_id" },
  );

  await supabase.from("user_roles").delete().eq("user_id", userId);
  for (const role of person.roles) {
    await supabase.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
  }

  if (person.roles.includes("admin") || person.roles.includes("professor")) {
    await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", "aluno");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);

  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };

  try {
    const allowDevSeed = getEnvOptional("ALLOW_DEV_SEED") === "true";
    const seedSecret = getEnvOptional("SEED_DEV_SECRET");
    const incomingSecret = req.headers.get("x-seed-secret");

    if (!allowDevSeed) {
      return new Response(JSON.stringify({ error: "Seed desabilitado em produção" }), { status: 403, headers });
    }

    if (!seedSecret || incomingSecret !== seedSecret) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers });
    }

    const staff = parseStaffSeed();
    if (staff.length === 0) {
      return new Response(JSON.stringify({ error: "STAFF_SEED_JSON não configurado" }), { status: 400, headers });
    }

    const password = getEnvOptional("DEV_DEFAULT_PASSWORD") ?? "faithbrothers2026";
    const supabase = createServiceClient();

    const { data: academies } = await supabase.from("academies").select("id").limit(1);
    if (!academies?.length) {
      return new Response(JSON.stringify({ error: "Nenhuma academia encontrada" }), { status: 400, headers });
    }

    const results: Array<{ name: string; status: string }> = [];
    for (const member of staff) {
      try {
        await ensureUser(supabase, academies[0].id, member, password);
        results.push({ name: member.name, status: "ok" });
      } catch (e) {
        results.push({ name: member.name, status: e instanceof Error ? e.message : "error" });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers });
  }
});
