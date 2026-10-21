-- Break RLS recursion between family_groups, family_members and student_contracts.
-- Additive. Does not edit historical migrations. Does not loosen academy isolation.
--
-- Cycle that 500'd homologation:
--   family_groups_select → SELECT family_members (RLS)
--     → family_members_select → SELECT family_groups (RLS)
--       → family_groups_select …
-- student_contracts_select also read family_members, joining the same cycle.
--
-- Fix: membership/admin checks run in SECURITY DEFINER helpers (bypass RLS on
-- those tables) while policies keep academy-scoped admin vs member rules.

CREATE OR REPLACE FUNCTION public.is_active_family_member(_family_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_members fm
    JOIN public.students s ON s.id = fm.student_id
    WHERE fm.family_group_id = _family_group_id
      AND s.profile_user_id = auth.uid()
      AND fm.status IN ('pendente', 'ativo')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_of_family_group(_family_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_groups g
    WHERE g.id = _family_group_id
      AND public.is_admin_of_academy(g.academy_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_only_of_family_group(_family_group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.family_groups g
    WHERE g.id = _family_group_id
      AND public.is_admin_only(g.academy_id)
  )
$$;

REVOKE ALL ON FUNCTION public.is_active_family_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_of_family_group(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_only_of_family_group(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_family_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_of_family_group(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_only_of_family_group(UUID) TO authenticated;

DROP POLICY IF EXISTS family_groups_select ON public.family_groups;
CREATE POLICY family_groups_select ON public.family_groups
  FOR SELECT TO authenticated
  USING (
    public.is_admin_of_academy(academy_id)
    OR public.is_active_family_member(id)
  );

DROP POLICY IF EXISTS family_members_select ON public.family_members;
CREATE POLICY family_members_select ON public.family_members
  FOR SELECT TO authenticated
  USING (
    public.can_access_student(student_id)
    OR public.is_admin_of_family_group(family_group_id)
  );

DROP POLICY IF EXISTS family_members_admin_all ON public.family_members;
CREATE POLICY family_members_admin_all ON public.family_members
  FOR ALL TO authenticated
  USING (public.is_admin_only_of_family_group(family_group_id))
  WITH CHECK (public.is_admin_only_of_family_group(family_group_id));

DROP POLICY IF EXISTS student_contracts_select ON public.student_contracts;
CREATE POLICY student_contracts_select ON public.student_contracts
  FOR SELECT TO authenticated
  USING (
    public.is_admin_of_academy(academy_id)
    OR (student_id IS NOT NULL AND public.can_access_student(student_id))
    OR (
      family_group_id IS NOT NULL
      AND public.is_active_family_member(family_group_id)
    )
  );
