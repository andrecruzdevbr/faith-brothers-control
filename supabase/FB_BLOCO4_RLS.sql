-- ================================================================
-- FAITH BROTHERS — BLOCO 4: RLS (Row Level Security)
-- Pré-requisito: BLOCO 3 executado
-- DROP POLICY IF EXISTS antes de cada CREATE — seguro reexecutar
-- ================================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.academies                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_tokens               ENABLE ROW LEVEL SECURITY;

-- ── academies ─────────────────────────────────────────────────────
-- anon pode listar academias (necessário para o dropdown de cadastro)
DROP POLICY IF EXISTS "acad_anon_select"  ON public.academies;
DROP POLICY IF EXISTS "acad_auth_select"  ON public.academies;
DROP POLICY IF EXISTS "acad_admin_update" ON public.academies;
CREATE POLICY "acad_anon_select"
  ON public.academies FOR SELECT TO anon USING (true);
CREATE POLICY "acad_auth_select"
  ON public.academies FOR SELECT TO authenticated
  USING (id = public.get_my_academy_id());
CREATE POLICY "acad_admin_update"
  ON public.academies FOR UPDATE TO authenticated
  USING      (public.is_admin_of_academy(id))
  WITH CHECK (public.is_admin_of_academy(id));

-- ── profiles ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "prof_select" ON public.profiles;
DROP POLICY IF EXISTS "prof_insert" ON public.profiles;
DROP POLICY IF EXISTS "prof_update" ON public.profiles;
CREATE POLICY "prof_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (academy_id = public.get_my_academy_id()
        AND public.is_admin_of_academy(academy_id))
  );
CREATE POLICY "prof_insert"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin_of_academy(academy_id)
  );
CREATE POLICY "prof_update"
  ON public.profiles FOR UPDATE TO authenticated
  USING      (user_id = auth.uid() OR public.is_admin_of_academy(academy_id))
  WITH CHECK (user_id = auth.uid() OR public.is_admin_of_academy(academy_id));

-- ── user_roles ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ur_select" ON public.user_roles;
DROP POLICY IF EXISTS "ur_insert" ON public.user_roles;
DROP POLICY IF EXISTS "ur_update" ON public.user_roles;
DROP POLICY IF EXISTS "ur_delete" ON public.user_roles;
CREATE POLICY "ur_select"
  ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = public.user_roles.user_id
        AND public.is_admin_of_academy(p.academy_id)
    )
  );
CREATE POLICY "ur_insert"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = public.user_roles.user_id
        AND public.is_admin_of_academy(p.academy_id)
    )
  );
CREATE POLICY "ur_update"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = public.user_roles.user_id AND public.is_admin_of_academy(p.academy_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = public.user_roles.user_id AND public.is_admin_of_academy(p.academy_id)));
CREATE POLICY "ur_delete"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = public.user_roles.user_id
        AND public.is_admin_of_academy(p.academy_id)
    )
  );

-- ── academy_billing_settings ─────────────────────────────────────
DROP POLICY IF EXISTS "abs_select" ON public.academy_billing_settings;
DROP POLICY IF EXISTS "abs_all"    ON public.academy_billing_settings;
CREATE POLICY "abs_select"
  ON public.academy_billing_settings FOR SELECT TO authenticated
  USING (academy_id = public.get_my_academy_id());
CREATE POLICY "abs_all"
  ON public.academy_billing_settings FOR ALL TO authenticated
  USING      (public.is_admin_of_academy(academy_id))
  WITH CHECK (public.is_admin_of_academy(academy_id));

-- ── plans ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "plans_select" ON public.plans;
DROP POLICY IF EXISTS "plans_all"    ON public.plans;
CREATE POLICY "plans_select"
  ON public.plans FOR SELECT TO authenticated
  USING (academy_id = public.get_my_academy_id());
CREATE POLICY "plans_all"
  ON public.plans FOR ALL TO authenticated
  USING      (public.is_admin_of_academy(academy_id))
  WITH CHECK (public.is_admin_of_academy(academy_id));

-- ── students ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "st_select" ON public.students;
DROP POLICY IF EXISTS "st_insert" ON public.students;
DROP POLICY IF EXISTS "st_update" ON public.students;
DROP POLICY IF EXISTS "st_delete" ON public.students;
CREATE POLICY "st_select"
  ON public.students FOR SELECT TO authenticated
  USING (public.can_access_student(id));
CREATE POLICY "st_insert"
  ON public.students FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_of_academy(academy_id));
CREATE POLICY "st_update"
  ON public.students FOR UPDATE TO authenticated
  USING      (public.is_admin_of_academy(academy_id))
  WITH CHECK (public.is_admin_of_academy(academy_id));
CREATE POLICY "st_delete"
  ON public.students FOR DELETE TO authenticated
  USING (public.is_admin_of_academy(academy_id));

-- ── billings ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bill_select" ON public.billings;
DROP POLICY IF EXISTS "bill_all"    ON public.billings;
CREATE POLICY "bill_select"
  ON public.billings FOR SELECT TO authenticated
  USING (public.can_access_billing(id));
CREATE POLICY "bill_all"
  ON public.billings FOR ALL TO authenticated
  USING      (public.is_admin_of_academy(academy_id))
  WITH CHECK (public.is_admin_of_academy(academy_id));

-- ── attendance_sessions ───────────────────────────────────────────
-- admin E professor podem criar/gerenciar (is_admin_of_academy inclui professor)
-- aluno pode apenas visualizar sessões da própria academia
DROP POLICY IF EXISTS "as_manage" ON public.attendance_sessions;
DROP POLICY IF EXISTS "as_select" ON public.attendance_sessions;
CREATE POLICY "as_manage"
  ON public.attendance_sessions FOR ALL TO authenticated
  USING      (public.is_admin_of_academy(academy_id))
  WITH CHECK (public.is_admin_of_academy(academy_id));
CREATE POLICY "as_select"
  ON public.attendance_sessions FOR SELECT TO authenticated
  USING (academy_id = public.get_my_academy_id());

-- ── attendances ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "att_manage" ON public.attendances;
DROP POLICY IF EXISTS "att_view"   ON public.attendances;
DROP POLICY IF EXISTS "att_insert" ON public.attendances;
CREATE POLICY "att_manage"
  ON public.attendances FOR ALL TO authenticated
  USING      (public.is_admin_of_academy(academy_id))
  WITH CHECK (public.is_admin_of_academy(academy_id));
CREATE POLICY "att_view"
  ON public.attendances FOR SELECT TO authenticated
  USING (public.can_access_student(student_id));
CREATE POLICY "att_insert"
  ON public.attendances FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_student(student_id)
    AND academy_id = public.get_my_academy_id()
  );

-- Verificação: deve mostrar todas as tabelas com pelo menos 1 policy
SELECT tablename, COUNT(*) AS num_policies
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
