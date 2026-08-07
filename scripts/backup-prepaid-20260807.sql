-- ============================================================
-- BACKUP LÓGICO PRÉ-MIGRATIONS prepaid/family (2026-08-07)
-- NÃO APAGA NADA. Snapshot em schema backup.
-- ============================================================

create schema if not exists backup_prepaid_20260807;

drop table if exists backup_prepaid_20260807.students cascade;
drop table if exists backup_prepaid_20260807.billings cascade;
drop table if exists backup_prepaid_20260807.plans cascade;
drop table if exists backup_prepaid_20260807.profiles cascade;
drop table if exists backup_prepaid_20260807.academy_billing_settings cascade;
drop table if exists backup_prepaid_20260807.student_billing_profiles cascade;
drop table if exists backup_prepaid_20260807.academies cascade;

create table backup_prepaid_20260807.students as select * from public.students;
create table backup_prepaid_20260807.billings as select * from public.billings;
create table backup_prepaid_20260807.plans as select * from public.plans;
create table backup_prepaid_20260807.profiles as select * from public.profiles;
create table backup_prepaid_20260807.academy_billing_settings as select * from public.academy_billing_settings;
create table backup_prepaid_20260807.student_billing_profiles as select * from public.student_billing_profiles;
create table backup_prepaid_20260807.academies as select * from public.academies;

-- Contagens pré-migration
select 'students' as tbl, count(*)::int as n from public.students
union all select 'billings', count(*)::int from public.billings
union all select 'plans', count(*)::int from public.plans
union all select 'profiles', count(*)::int from public.profiles
union all select 'academy_billing_settings', count(*)::int from public.academy_billing_settings
union all select 'student_billing_profiles', count(*)::int from public.student_billing_profiles
union all select 'bk_students', count(*)::int from backup_prepaid_20260807.students
union all select 'bk_billings', count(*)::int from backup_prepaid_20260807.billings
union all select 'bk_plans', count(*)::int from backup_prepaid_20260807.plans;
