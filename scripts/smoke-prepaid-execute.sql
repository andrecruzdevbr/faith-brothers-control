-- SMOKE prepaid/family — read + synthetic pending rows — NO payment confirm / NO Asaas / NO WA send

-- A) Public plans now include machine packages
select name, billing_mode, duration_months, package_total_amount
from public.get_public_active_plans('767b774a-2806-4a18-8d58-a0c95e359bc0')
order by billing_mode, name;

-- B) Coverage month helper (15/08/2026 → 6 months)
select public.prepaid_coverage_months('2026-08-15'::date, 6) as months;
select public.prepaid_ends_on('2026-08-15'::date, 6) as ends_on;

-- C) Create temporary smoke family group (pending only)
insert into public.family_groups (
  academy_id, name, invite_code,
  financial_responsible_name, financial_responsible_tax_id,
  financial_responsible_phone, status, estimated_member_count
) values (
  '767b774a-2806-4a18-8d58-a0c95e359bc0',
  'SMOKE Família Prepaid',
  'SMOKE001',
  'Smoke Responsavel',
  '00000000000',
  '31999990000',
  'pendente',
  3
)
on conflict (academy_id, invite_code) do update
set name = excluded.name, status = 'pendente', updated_at = now()
returning id, invite_code, status;

-- D) Cron skip with no coverage → null
select public.prepaid_cron_skip_reason(
  (select id from public.students order by created_at limit 1),
  date_trunc('month', now())::date
) as skip_reason_without_coverage;

-- E) Legacy asaas plans still active
select count(*)::int as asaas_monthly_active
from public.plans
where academy_id = '767b774a-2806-4a18-8d58-a0c95e359bc0'
  and billing_mode = 'asaas_monthly'
  and active;

-- F) Data preservation vs backup
select
  (select count(*) from public.students) as students_now,
  (select count(*) from backup_prepaid_20260807.students) as students_bk,
  (select count(*) from public.billings) as billings_now,
  (select count(*) from backup_prepaid_20260807.billings) as billings_bk;

-- G) Cleanup smoke family (no students linked yet — safe)
delete from public.family_groups
where academy_id = '767b774a-2806-4a18-8d58-a0c95e359bc0'
  and invite_code = 'SMOKE001';
