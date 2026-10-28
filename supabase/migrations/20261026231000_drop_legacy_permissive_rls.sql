-- Drop leftover English RLS policies that bypass later admin-only replacements.
-- Does not delete rows. Does not disable RLS.
--
-- Dependencies checked:
--   academies SELECT: keep acad_auth_select (tightened to admin) + get_my_academy_basic_info()
--   academies UPDATE: keep "Admins can update own academy"
--   billings: keep bill_admin_all + bill_staff_select (can_access_billing for own student rows)
--   plans: keep plans_admin_all + plans_staff_select + student catalog SELECT
--   profiles UPDATE: keep prof_update (locks academy_id / whatsapp for self-update)
--   user_roles writes: keep ur_admin_insert/update/delete
--   academy_billing_settings: keep abs_admin_all
--
-- Recovery: recreate dropped policies from
--   20260316120224_723ea8cb-fc37-4e54-af07-8928a751ea24.sql
--   20260731200100_client_staff_access_and_address.sql (acad_auth_select original)

-- 1) Academies: students must not SELECT bank/finance columns.
DROP POLICY IF EXISTS "Users can view own academy" ON public.academies;
DROP POLICY IF EXISTS "acad_auth_select" ON public.academies;
CREATE POLICY "acad_auth_select"
  ON public.academies FOR SELECT TO authenticated
  USING (
    id = public.get_my_academy_id()
    AND public.is_admin_of_academy(id)
  );

-- 2) Billings: leftover FOR ALL / broad SELECT. Students keep own rows via bill_staff_select.
DROP POLICY IF EXISTS "Admins can manage academy billings" ON public.billings;
DROP POLICY IF EXISTS "Admins can view academy billings and students can view own billings" ON public.billings;
DROP POLICY IF EXISTS "Admins can view academy billings and students can view own bill" ON public.billings;

-- 3) Plans: leftover FOR ALL. Catalog SELECT for academy members stays.
DROP POLICY IF EXISTS "Admins can manage plans from own academy" ON public.plans;

-- 4) Profiles: leftover UPDATE allowed changing academy_id.
DROP POLICY IF EXISTS "Users can update own profile or admins can update academy profiles" ON public.profiles;

-- 5) user_roles: leftover writes broader than ur_admin_*.
DROP POLICY IF EXISTS "Admins can manage roles in their academy" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles in their academy" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles in their academy" ON public.user_roles;

-- 6) Billing settings: members must not read finance configuration.
DROP POLICY IF EXISTS "Users can view academy billing settings" ON public.academy_billing_settings;
DROP POLICY IF EXISTS "Admins can manage academy billing settings" ON public.academy_billing_settings;
