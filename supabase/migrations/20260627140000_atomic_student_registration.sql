-- Cadastro atômico de aluno: RPC exclusiva para service_role + índices de unicidade

-- ── Unicidade de WhatsApp (dígitos normalizados) ───────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_whatsapp_digits_unique
  ON public.profiles (
    (regexp_replace(btrim(COALESCE(whatsapp, '')), '[^0-9]', '', 'g'))
  )
  WHERE whatsapp IS NOT NULL
    AND regexp_replace(btrim(COALESCE(whatsapp, '')), '[^0-9]', '', 'g') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_whatsapp_digits_unique
  ON public.students (
    (regexp_replace(btrim(whatsapp), '[^0-9]', '', 'g'))
  )
  WHERE regexp_replace(btrim(whatsapp), '[^0-9]', '', 'g') <> '';

-- students.profile_user_id já possui UNIQUE; profiles.user_id já é PRIMARY KEY

-- ── RPC transacional (somente service_role) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_student_registration_atomic(
  _user_id    UUID,
  _academy_id UUID,
  _full_name  TEXT,
  _whatsapp   TEXT,
  _belt       TEXT DEFAULT 'Branca'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean_wa          TEXT;
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

  IF NOT EXISTS (SELECT 1 FROM public.academies WHERE id = _academy_id) THEN
    RAISE EXCEPTION 'Academia inválida'
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
    status
  )
  VALUES (
    _academy_id,
    _user_id,
    _full_name_trimmed,
    _clean_wa,
    _belt_val,
    0,
    'pendente_aprovacao'::public.student_status
  )
  ON CONFLICT (profile_user_id) DO NOTHING;

  SELECT s.id
  INTO _student_id
  FROM public.students s
  WHERE s.profile_user_id = _user_id
  LIMIT 1;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível criar o registro do aluno'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN _student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
