/**
 * Staging-only financial homologation. Never prints secrets.
 * Target: apbksfaztfkxshxffpik + Asaas api-sandbox.asaas.com
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STAGING_REF = "apbksfaztfkxshxffpik";
const PRODUCTION_REF = "wojqjxtaqjasnfhbotxi";
const API = "https://api.supabase.com/v1";
const FUNCTIONS = `https://${STAGING_REF}.supabase.co/functions/v1`;
const MARKER = "HOMOLOG_BOLETO_FB";

function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const candidates = [
    join(homedir(), ".supabase", "access-token"),
    join(homedir(), "AppData", "Roaming", "supabase", "access-token"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      const raw = readFileSync(file, "utf8").trim();
      if (raw) return raw;
    }
  }
  throw new Error("Supabase access token not found");
}

async function mgmt(path, init = {}) {
  const token = accessToken();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let data = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 200) };
    }
  }
  if (!response.ok) {
    throw new Error(`Management ${response.status} ${path}: ${typeof data === "object" ? JSON.stringify(data).slice(0, 300) : ""}`);
  }
  return data;
}

async function sql(query) {
  const data = await mgmt(`/projects/${STAGING_REF}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  return Array.isArray(data) ? data : data;
}

async function serviceRoleKey() {
  const keys = await mgmt(`/projects/${STAGING_REF}/api-keys`);
  const list = Array.isArray(keys) ? keys : keys.keys ?? keys.api_keys ?? [];
  const row = list.find((item) => item.name === "service_role" || item.type === "service_role");
  const value = row?.api_key ?? row?.key ?? row?.value;
  if (!value) throw new Error("Staging service_role key not available via Management API");
  return value;
}

async function invokeGenerate(body, serviceKey) {
  const response = await fetch(`${FUNCTIONS}/generate-monthly-billings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function log(label, value) {
  console.log(label, typeof value === "string" ? value : JSON.stringify(value));
}

async function main() {
  if (STAGING_REF === PRODUCTION_REF) throw new Error("ref mixup");
  log("target", STAGING_REF);
  log("asaas_host_expected", "api-sandbox.asaas.com");

  const academy = (await sql(
    "select id, asaas_environment_label from public.academies order by created_at limit 1",
  ))[0];
  if (!academy?.id) throw new Error("Staging academy missing");
  log("academy", { id: academy.id, asaas_environment_label: academy.asaas_environment_label ?? null });

  const monthly = (await sql(`
    select id, name, monthly_price, billing_mode
    from public.plans
    where academy_id = '${academy.id}'
      and coalesce(billing_mode, 'asaas_monthly') = 'asaas_monthly'
      and coalesce(monthly_price, 0) > 0
      and coalesce(active, true) = true
    order by monthly_price
    limit 1
  `))[0];
  if (!monthly?.id) throw new Error("No asaas_monthly plan on staging");
  log("monthly_plan", { id: monthly.id, name: monthly.name, monthly_price: monthly.monthly_price });

  const prepaid = (await sql(`
    select id, name, billing_mode
    from public.plans
    where academy_id = '${academy.id}'
      and billing_mode = 'machine_prepaid'
    limit 1
  `))[0];

  await sql(`
    insert into public.academy_billing_settings (academy_id, boleto_issue_day, boleto_due_day, send_whatsapp_automatically)
    values ('${academy.id}', 12, 15, false)
    on conflict (academy_id) do update
      set boleto_issue_day = 12, boleto_due_day = 15, send_whatsapp_automatically = false
  `);

  const seed = `
    with upserted as (
      insert into public.students (
        academy_id, full_name, whatsapp, email, status, plan_id, requested_payment_method, payment_review_status
      )
      values
        ('${academy.id}', '${MARKER} ATIVO BOLETO', '5531999000099', 'homolog.boleto@invalid.local', 'ativo', '${monthly.id}', 'boleto', 'nao_aplicavel'),
        ('${academy.id}', '${MARKER} ATIVO PIX', '5531999000098', 'homolog.pix@invalid.local', 'ativo', '${monthly.id}', 'pix', 'nao_aplicavel'),
        ('${academy.id}', '${MARKER} PENDENTE BOLETO', '5531999000097', 'homolog.pendente@invalid.local', 'pendente_aprovacao', '${monthly.id}', 'boleto', 'nao_aplicavel'),
        ('${academy.id}', '${MARKER} INATIVO BOLETO', '5531999000096', 'homolog.inativo@invalid.local', 'inativo', '${monthly.id}', 'boleto', 'nao_aplicavel')
        ${prepaid?.id ? `, ('${academy.id}', '${MARKER} PREPAGO', '5531999000095', 'homolog.prepaid@invalid.local', 'ativo', '${prepaid.id}', 'boleto', 'nao_aplicavel')` : ""}
      returning id, full_name, status, requested_payment_method, plan_id
    )
    select * from upserted
  `;

  let seeded;
  try {
    seeded = await sql(seed);
  } catch (error) {
    const cleanup = await sql(
      `select id, full_name, status, requested_payment_method from public.students where full_name like '${MARKER}%'`,
    );
    if (!cleanup?.length) throw error;
    seeded = cleanup;
    log("seed_reused", true);
  }

  const boleto = seeded.find((row) => String(row.full_name).includes("ATIVO BOLETO"));
  if (!boleto?.id) throw new Error("Eligible homolog student missing");

  await sql(`
    insert into public.student_billing_profiles (student_id, tax_id)
    values ('${boleto.id}', '24971563792')
    on conflict (student_id) do update set tax_id = excluded.tax_id
  `);

  const serviceKey = await serviceRoleKey();
  const dryRun = await invokeGenerate(
    { dryRun: true, sendWhatsApp: false, force: false, studentId: boleto.id },
    serviceKey,
  );
  log("dry_run_status", dryRun.status);
  log("dry_run_summary", dryRun.payload?.summary ?? dryRun.payload);
  log(
    "dry_run_processed",
    (dryRun.payload?.processed ?? []).map((row) => ({
      status: row.status,
      studentName: row.studentName,
      amount: row.amount,
      dueDate: row.dueDate,
      referenceMonth: row.referenceMonth,
    })),
  );

  const pix = seeded.find((row) => String(row.full_name).includes("ATIVO PIX"));
  if (pix?.id) {
    const pixRun = await invokeGenerate(
      { dryRun: true, sendWhatsApp: false, studentId: pix.id },
      serviceKey,
    );
    log("pix_exclusion", {
      http: pixRun.status,
      processed: (pixRun.payload?.processed ?? []).map((row) => row.status),
    });
  }

  const emit = await invokeGenerate(
    { dryRun: false, sendWhatsApp: false, sandboxConfirm: true, force: false, studentId: boleto.id },
    serviceKey,
  );
  log("emit_status", emit.status);
  log("emit_summary", emit.payload?.summary ?? emit.payload);
  log(
    "emit_processed",
    (emit.payload?.processed ?? []).map((row) => ({
      status: row.status,
      billingId: row.billingId,
      error: row.error ?? null,
    })),
  );

  const dup = await invokeGenerate(
    { dryRun: false, sendWhatsApp: false, sandboxConfirm: false, force: false, studentId: boleto.id },
    serviceKey,
  );
  log("duplicate_status", dup.status);
  log(
    "duplicate_processed",
    (dup.payload?.processed ?? []).map((row) => ({ status: row.status, billingId: row.billingId })),
  );

  const finance = await sql(`
    select b.status, b.amount, b.due_date, b.reference_month, b.asaas_payment_id is not null as has_asaas_id,
           left(coalesce(b.boleto_url, ''), 40) as boleto_prefix
    from public.billings b
    where b.student_id = '${boleto.id}'
    order by b.created_at desc
    limit 3
  `);
  log("finance_rows", finance);

  const counts = await sql(`
    select requested_payment_method, status, count(*)::int as n
    from public.students
    where full_name like '${MARKER}%'
    group by 1, 2
    order by 1, 2
  `);
  log("homolog_students", counts);
}

main().catch((error) => {
  console.error("HOMOLOG_FAILED", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
