-- Contagens pré/pós apply — Fluxo Familiar V2 (sem PII)
select 'students' as metric, count(*)::int as n from public.students
union all select 'students_ativo', count(*)::int from public.students where status = 'ativo'
union all select 'students_pendente', count(*)::int from public.students where status = 'pendente_aprovacao'
union all select 'family_groups', count(*)::int from public.family_groups
union all select 'family_groups_ativo', count(*)::int from public.family_groups where status = 'ativo'
union all select 'family_members', count(*)::int from public.family_members
union all select 'student_contracts', count(*)::int from public.student_contracts
union all select 'student_contracts_ativo', count(*)::int from public.student_contracts where contract_status = 'ativo'
union all select 'contract_payments', count(*)::int from public.contract_payments
union all select 'student_contract_months', count(*)::int from public.student_contract_months
union all select 'billings', count(*)::int from public.billings
union all select 'family_members_notes_col',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'family_members' and column_name = 'notes'
  ) then 1 else 0 end
union all select 'family_members_freq_col',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'family_members' and column_name = 'requested_weekly_frequency'
  ) then 1 else 0 end
union all select 'rpc_register_family_wizard',
  case when to_regprocedure('public.register_family_wizard_atomic(uuid,uuid,text,text,text,text,uuid,date,text,text,integer,text,text,integer,jsonb,boolean,integer)') is not null
    then 1 else 0 end
union all select 'rpc_search_family_students',
  case when to_regprocedure('public.search_academy_students_for_family(uuid,text,integer)') is not null
    then 1 else 0 end
union all select 'rpc_confirm_family_prepaid',
  case when to_regprocedure('public.confirm_family_prepaid_payment(uuid,uuid,date,text,integer,uuid[],numeric,text,text,jsonb)') is not null
    then 1 else 0 end
order by 1;
