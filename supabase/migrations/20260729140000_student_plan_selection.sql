-- Planos no cadastro público + vínculo admin em students.plan_id

CREATE OR REPLACE FUNCTION public.get_public_active_plans(_academy_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  monthly_price NUMERIC,
  training_days_per_week INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.monthly_price, p.training_days_per_week
  FROM public.plans p
  WHERE p.academy_id = _academy_id
    AND p.active = TRUE
  ORDER BY p.monthly_price ASC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_active_plans(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_active_plans(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_active_plans(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_active_plans(UUID) TO service_role;

-- Staff pode ler planos da academia (além do admin ALL)
DROP POLICY IF EXISTS "plans_staff_select" ON public.plans;
CREATE POLICY "plans_staff_select"
  ON public.plans FOR SELECT TO authenticated
  USING (public.is_staff_of_academy(academy_id));

CREATE OR REPLACE FUNCTION public.update_student_plan(
  _student_id UUID,
  _plan_id    UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id INTO _academy
  FROM public.students s
  WHERE s.id = _student_id;

  IF _academy IS NULL OR NOT public.is_staff_of_academy(_academy) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = 'P0001';
  END IF;

  IF _plan_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.plans p
      WHERE p.id = _plan_id
        AND p.academy_id = _academy
        AND p.active = TRUE
    ) THEN
      RAISE EXCEPTION 'Plano inválido ou inativo para esta academia.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.students
  SET plan_id = _plan_id,
      updated_at = now()
  WHERE id = _student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_student_plan(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_student_plan(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_student_plan(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_student_plan(UUID, UUID) TO service_role;

-- Cadastro atômico passa a gravar plan_id em students
DROP FUNCTION IF EXISTS public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.complete_student_registration_atomic(
  _user_id    UUID,
  _academy_id UUID,
  _full_name  TEXT,
  _whatsapp   TEXT,
  _belt       TEXT DEFAULT 'Branca',
  _tax_id     TEXT DEFAULT NULL,
  _plan_id    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean_wa          TEXT;
  _clean_tax         TEXT;
  _full_name_trimmed TEXT;
  _belt_val          TEXT;
  _student_id        UUID;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id obrigatório'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Usuário de autenticação não encontrado'
      USING ERRCODE = 'P0001';
  END IF;

  _full_name_trimmed := left(btrim(_full_name), 120);
  IF _full_name_trimmed IS NULL OR _full_name_trimmed = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório'
      USING ERRCODE = 'P0001';
  END IF;

  _clean_wa := regexp_replace(btrim(COALESCE(_whatsapp, '')), '[^0-9]', '', 'g');
  IF length(_clean_wa) >= 12 AND _clean_wa LIKE '55%' THEN
    _clean_wa := substring(_clean_wa FROM 3);
  END IF;

  IF _clean_wa !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'WhatsApp inválido. Informe 11 dígitos com DDD.'
      USING ERRCODE = 'P0001';
  END IF;

  _clean_tax := public.normalize_tax_id(_tax_id);
  IF _clean_tax IS NULL OR NOT public.is_valid_tax_id(_clean_tax) THEN
    RAISE EXCEPTION 'CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.academies WHERE id = _academy_id) THEN
    RAISE EXCEPTION 'Academia inválida'
      USING ERRCODE = 'P0001';
  END IF;

  IF _plan_id IS NULL THEN
    RAISE EXCEPTION 'Selecione um plano desejado.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = _plan_id
      AND p.academy_id = _academy_id
      AND p.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Plano inválido ou inativo para esta academia.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('admin', 'professor')
  ) THEN
    RAISE EXCEPTION 'Este usuário já possui papel de equipe'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE regexp_replace(btrim(COALESCE(p.whatsapp, '')), '[^0-9]', '', 'g') = _clean_wa
      AND p.user_id <> _user_id
  ) THEN
    RAISE EXCEPTION 'Este WhatsApp já está cadastrado.'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.students s
    WHERE regexp_replace(btrim(s.whatsapp), '[^0-9]', '', 'g') = _clean_wa
      AND s.profile_user_id IS DISTINCT FROM _user_id
  ) THEN
    RAISE EXCEPTION 'Este WhatsApp já está cadastrado.'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_billing_profiles sbp
    WHERE sbp.tax_id = _clean_tax
  ) THEN
    RAISE EXCEPTION 'Este CPF/CNPJ já está cadastrado.'
      USING ERRCODE = '23505';
  END IF;

  _belt_val := COALESCE(NULLIF(btrim(COALESCE(_belt, '')), ''), 'Branca');

  INSERT INTO public.profiles (user_id, academy_id, full_name, whatsapp)
  VALUES (_user_id, _academy_id, _full_name_trimmed, _clean_wa)
  ON CONFLICT (user_id) DO UPDATE
    SET academy_id = EXCLUDED.academy_id,
        full_name  = EXCLUDED.full_name,
        whatsapp   = EXCLUDED.whatsapp,
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'aluno'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.students (
    academy_id,
    profile_user_id,
    full_name,
    whatsapp,
    belt,
    degrees,
    status,
    plan_id
  )
  VALUES (
    _academy_id,
    _user_id,
    _full_name_trimmed,
    _clean_wa,
    _belt_val,
    0,
    'pendente_aprovacao'::public.student_status,
    _plan_id
  )
  ON CONFLICT (profile_user_id) DO UPDATE
    SET academy_id = EXCLUDED.academy_id,
        full_name  = EXCLUDED.full_name,
        whatsapp   = EXCLUDED.whatsapp,
        belt       = EXCLUDED.belt,
        plan_id    = EXCLUDED.plan_id,
        status     = 'pendente_aprovacao'::public.student_status,
        updated_at = now();

  SELECT s.id
  INTO _student_id
  FROM public.students s
  WHERE s.profile_user_id = _user_id
  LIMIT 1;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível criar o registro do aluno'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.student_billing_profiles (student_id, tax_id)
  VALUES (_student_id, _clean_tax)
  ON CONFLICT (student_id) DO UPDATE
    SET tax_id = EXCLUDED.tax_id,
        updated_at = now();

  RETURN _student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;
