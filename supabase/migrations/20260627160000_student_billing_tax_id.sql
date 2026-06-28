-- Dados financeiros restritos do aluno (CPF/CNPJ para cobrança Asaas)

-- ── Validação real de CPF/CNPJ (dígitos verificadores) ───────────────────────
CREATE OR REPLACE FUNCTION public.normalize_tax_id(_raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(_raw, ''), '[^0-9]', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.tax_id_all_same_digits(_digits TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _digits IS NOT NULL AND _digits ~ '^(\d)\1+$'
$$;

CREATE OR REPLACE FUNCTION public.is_valid_cpf(_cpf TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _sum   INT;
  _rest  INT;
  _digit INT;
BEGIN
  IF _cpf IS NULL OR length(_cpf) <> 11 OR public.tax_id_all_same_digits(_cpf) THEN
    RETURN FALSE;
  END IF;

  _sum := 0;
  FOR i IN 1..9 LOOP
    _sum := _sum + (substring(_cpf, i, 1)::INT * (11 - i));
  END LOOP;
  _rest := (_sum * 10) % 11;
  IF _rest = 10 THEN _rest := 0; END IF;
  _digit := substring(_cpf, 10, 1)::INT;
  IF _rest <> _digit THEN RETURN FALSE; END IF;

  _sum := 0;
  FOR i IN 1..10 LOOP
    _sum := _sum + (substring(_cpf, i, 1)::INT * (12 - i));
  END LOOP;
  _rest := (_sum * 10) % 11;
  IF _rest = 10 THEN _rest := 0; END IF;
  _digit := substring(_cpf, 11, 1)::INT;
  RETURN _rest = _digit;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_cnpj(_cnpj TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _weights1 INT[] := ARRAY[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  _weights2 INT[] := ARRAY[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  _sum      INT;
  _rest     INT;
  _digit    INT;
  i         INT;
BEGIN
  IF _cnpj IS NULL OR length(_cnpj) <> 14 OR public.tax_id_all_same_digits(_cnpj) THEN
    RETURN FALSE;
  END IF;

  _sum := 0;
  FOR i IN 1..12 LOOP
    _sum := _sum + (substring(_cnpj, i, 1)::INT * _weights1[i]);
  END LOOP;
  _rest := _sum % 11;
  _digit := CASE WHEN _rest < 2 THEN 0 ELSE 11 - _rest END;
  IF _digit <> substring(_cnpj, 13, 1)::INT THEN RETURN FALSE; END IF;

  _sum := 0;
  FOR i IN 1..13 LOOP
    _sum := _sum + (substring(_cnpj, i, 1)::INT * _weights2[i]);
  END LOOP;
  _rest := _sum % 11;
  _digit := CASE WHEN _rest < 2 THEN 0 ELSE 11 - _rest END;
  RETURN _digit = substring(_cnpj, 14, 1)::INT;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_tax_id(_tax_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _clean TEXT;
BEGIN
  IF _tax_id IS NULL THEN
    RETURN FALSE;
  END IF;

  _clean := public.normalize_tax_id(_tax_id);
  IF _clean IS NULL THEN
    RETURN FALSE;
  END IF;

  IF length(_clean) = 11 THEN
    RETURN public.is_valid_cpf(_clean);
  END IF;

  IF length(_clean) = 14 THEN
    RETURN public.is_valid_cnpj(_clean);
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.mask_tax_id(_tax_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_valid_cpf(_tax_id) THEN '***.***.***-' || right(_tax_id, 2)
    WHEN public.is_valid_cnpj(_tax_id) THEN '**.***.***/****-' || right(_tax_id, 2)
    ELSE NULL
  END
$$;

-- ── Tabela restrita (tax_id somente dígitos normalizados) ────────────────────
CREATE TABLE IF NOT EXISTS public.student_billing_profiles (
  student_id UUID NOT NULL PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  tax_id     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_billing_profiles_tax_id_valid CHECK (
    tax_id IS NULL
    OR (
      tax_id = public.normalize_tax_id(tax_id)
      AND public.is_valid_tax_id(tax_id)
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_billing_profiles_tax_id_unique
  ON public.student_billing_profiles (public.normalize_tax_id(tax_id))
  WHERE tax_id IS NOT NULL
    AND public.normalize_tax_id(tax_id) IS NOT NULL;

DROP TRIGGER IF EXISTS trg_student_billing_profiles_updated_at ON public.student_billing_profiles;
CREATE TRIGGER trg_student_billing_profiles_updated_at
  BEFORE UPDATE ON public.student_billing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.student_billing_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_billing_profiles FROM PUBLIC;
REVOKE ALL ON public.student_billing_profiles FROM anon;
REVOKE ALL ON public.student_billing_profiles FROM authenticated;

-- ── RPCs de leitura mascarada e upsert autenticado ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_student_billing_tax_id_masked(_student_id UUID)
RETURNS TABLE (masked TEXT, has_tax_id BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.can_access_student(_student_id) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    public.mask_tax_id(sbp.tax_id),
    COALESCE(sbp.tax_id IS NOT NULL AND sbp.tax_id <> '', FALSE)
  FROM public.students s
  LEFT JOIN public.student_billing_profiles sbp ON sbp.student_id = s.id
  WHERE s.id = _student_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_student_billing_tax_id(
  _student_id UUID,
  _tax_id     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.can_access_student(_student_id) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = 'P0001';
  END IF;

  _clean := public.normalize_tax_id(_tax_id);

  IF _clean IS NULL OR NOT public.is_valid_tax_id(_clean) THEN
    RAISE EXCEPTION 'CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_billing_profiles sbp
    WHERE sbp.tax_id = _clean
      AND sbp.student_id <> _student_id
  ) THEN
    RAISE EXCEPTION 'Este CPF/CNPJ já está cadastrado para outro aluno.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.student_billing_profiles (student_id, tax_id)
  VALUES (_student_id, _clean)
  ON CONFLICT (student_id) DO UPDATE
    SET tax_id = EXCLUDED.tax_id,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_billing_tax_id_masked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_billing_tax_id_masked(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_billing_tax_id_masked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_billing_tax_id_masked(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_student_billing_tax_id(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_student_billing_tax_id(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_student_billing_tax_id(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_student_billing_tax_id(UUID, TEXT) TO service_role;

-- ── Cadastro atômico: inclui student_billing_profiles na mesma transação ───
DROP FUNCTION IF EXISTS public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.complete_student_registration_atomic(
  _user_id    UUID,
  _academy_id UUID,
  _full_name  TEXT,
  _whatsapp   TEXT,
  _belt       TEXT DEFAULT 'Branca',
  _tax_id     TEXT DEFAULT NULL
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

  INSERT INTO public.student_billing_profiles (student_id, tax_id)
  VALUES (_student_id, _clean_tax)
  ON CONFLICT (student_id) DO UPDATE
    SET tax_id = EXCLUDED.tax_id,
        updated_at = now();

  RETURN _student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
