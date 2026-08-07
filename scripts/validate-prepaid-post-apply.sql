-- Pós-apply validation prepaid/family
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'academy_billing_settings'
  and column_name in ('prepaid_contracts_enabled', 'family_plans_enabled');

select prepaid_contracts_enabled, family_plans_enabled
from public.academy_billing_settings;

select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'family_groups','family_members','student_contracts',
    'contract_members','student_contract_months','contract_payments'
  )
order by 1;

select 'students' as tbl, count(*)::int as n from public.students
union all select 'billings', count(*)::int from public.billings
union all select 'plans', count(*)::int from public.plans
union all select 'profiles', count(*)::int from public.profiles
union all select 'bk_students', count(*)::int from backup_prepaid_20260807.students
union all select 'bk_billings', count(*)::int from backup_prepaid_20260807.billings;

select name, billing_mode, duration_months, package_total_amount, active
from public.plans
order by name;

select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'confirm_individual_prepaid_payment',
    'confirm_family_prepaid_payment',
    'cancel_or_refund_prepaid_contract',
    'prepaid_cron_skip_reason',
    'student_has_prepaid_month_coverage',
    'complete_student_registration_atomic',
    'get_public_active_plans',
    'get_public_academies'
  )
order by 1;

select schemaname, tablename, policyname
from pg_policies
where tablename in (
  'family_groups','family_members','student_contracts',
  'contract_members','student_contract_months','contract_payments'
)
order by tablename, policyname;
