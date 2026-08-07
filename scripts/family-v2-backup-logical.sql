-- ============================================================
-- BACKUP LÓGICO — Fluxo Familiar V2 (pré-apply)
-- NÃO APAGA NADA. Snapshot em schema backup (PII fica só no DB).
-- NÃO versionar dumps com dados pessoais.
-- ============================================================

create schema if not exists backup_family_v2_20260807;

drop table if exists backup_family_v2_20260807.family_groups cascade;
drop table if exists backup_family_v2_20260807.family_members cascade;
drop table if exists backup_family_v2_20260807.student_contracts cascade;
drop table if exists backup_family_v2_20260807.contract_members cascade;
drop table if exists backup_family_v2_20260807.contract_payments cascade;
drop table if exists backup_family_v2_20260807.student_contract_months cascade;
drop table if exists backup_family_v2_20260807.students cascade;
drop table if exists backup_family_v2_20260807.student_billing_profiles cascade;
drop table if exists backup_family_v2_20260807.academy_billing_settings cascade;
drop table if exists backup_family_v2_20260807.pre_counts cascade;

create table backup_family_v2_20260807.family_groups as
  select * from public.family_groups;
create table backup_family_v2_20260807.family_members as
  select * from public.family_members;
create table backup_family_v2_20260807.student_contracts as
  select * from public.student_contracts;
create table backup_family_v2_20260807.contract_members as
  select * from public.contract_members;
create table backup_family_v2_20260807.contract_payments as
  select * from public.contract_payments;
create table backup_family_v2_20260807.student_contract_months as
  select * from public.student_contract_months;
create table backup_family_v2_20260807.students as
  select * from public.students;
create table backup_family_v2_20260807.student_billing_profiles as
  select * from public.student_billing_profiles;
create table backup_family_v2_20260807.academy_billing_settings as
  select * from public.academy_billing_settings;

create table backup_family_v2_20260807.pre_counts as
select * from (
  select 'students'::text as metric, count(*)::int as n from public.students
  union all select 'students_ativo', count(*)::int from public.students where status = 'ativo'
  union all select 'students_pendente', count(*)::int from public.students where status = 'pendente_aprovacao'
  union all select 'family_groups', count(*)::int from public.family_groups
  union all select 'family_members', count(*)::int from public.family_members
  union all select 'student_contracts', count(*)::int from public.student_contracts
  union all select 'contract_members', count(*)::int from public.contract_members
  union all select 'contract_payments', count(*)::int from public.contract_payments
  union all select 'student_contract_months', count(*)::int from public.student_contract_months
  union all select 'student_billing_profiles', count(*)::int from public.student_billing_profiles
  union all select 'billings', count(*)::int from public.billings
  union all select 'plans', count(*)::int from public.plans
) c;

select metric, n from backup_family_v2_20260807.pre_counts order by metric;
