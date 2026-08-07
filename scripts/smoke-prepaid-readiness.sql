-- Smoke test prepaid/family (NO payment confirm, NO Asaas, NO WhatsApp send)
-- Safe checks only.

-- 1) Flags (should be true only for Faith Brothers after activation)
select a.name, s.prepaid_contracts_enabled, s.family_plans_enabled
from public.academies a
join public.academy_billing_settings s on s.academy_id = a.id;

-- 2) Public plans respect flags
select id, name, billing_mode, duration_months, package_total_amount
from public.get_public_active_plans((select id from public.academies order by created_at limit 1));

-- 3) RPCs exist
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'confirm_individual_prepaid_payment',
    'confirm_family_prepaid_payment',
    'prepaid_cron_skip_reason',
    'approve_student'
  )
order by 1;

-- 4) Legacy counts preserved vs backup
select 'students' as tbl, count(*)::int as n from public.students
union all select 'bk_students', count(*)::int from backup_prepaid_20260807.students
union all select 'billings', count(*)::int from public.billings
union all select 'bk_billings', count(*)::int from backup_prepaid_20260807.billings
union all select 'asaas_plans', count(*)::int from public.plans where billing_mode = 'asaas_monthly'
union all select 'machine_plans', count(*)::int from public.plans where billing_mode like 'machine_%';
