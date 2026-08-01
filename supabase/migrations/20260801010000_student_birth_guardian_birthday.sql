-- Dados de nascimento/responsável + automação de aniversário WhatsApp.
-- Idempotente. Não apaga dados. birth_date permanece nullableável (alunos antigos).

-- ── Colunas em students ───────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS birth_date DATE;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS guardian_name TEXT;

COMMENT ON COLUMN public.students.birth_date IS
  'Data de nascimento do aluno. Obrigatória em novos cadastros/edições completas (app/RPC); nullable para legado.';
COMMENT ON COLUMN public.students.guardian_name IS
  'Nome do responsável. Obrigatório somente se o aluno for menor de 18 anos.';

-- ── Controle de envio de aniversário (anti-duplicidade por ano) ───
CREATE TABLE IF NOT EXISTS public.birthday_messages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academy_id     UUID        NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  birthday_year  INTEGER     NOT NULL,
  message_id     UUID        REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  status         TEXT        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  sent_at        TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, birthday_year)
);

CREATE INDEX IF NOT EXISTS idx_birthday_messages_academy_year
  ON public.birthday_messages (academy_id, birthday_year);

COMMENT ON TABLE public.birthday_messages IS
  'Controle de mensagens de aniversário WhatsApp (1 envio por aluno por ano).';

ALTER TABLE public.birthday_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bm_admin_select" ON public.birthday_messages;
CREATE POLICY "bm_admin_select"
  ON public.birthday_messages FOR SELECT TO authenticated
  USING (public.is_admin_only(academy_id));

-- Escrita apenas via service_role (Edge Function); sem policies de write para authenticated.

-- ── Cadastro atômico: birth_date + guardian_name ──────────────────
DROP FUNCTION IF EXISTS public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.complete_student_registration_atomic(
  _user_id       UUID,
  _academy_id    UUID,
  _full_name     TEXT,
  _whatsapp      TEXT,
  _belt          TEXT DEFAULT 'Branca',
  _tax_id        TEXT DEFAULT NULL,
  _plan_id       UUID DEFAULT NULL,
  _birth_date    DATE DEFAULT NULL,
  _guardian_name TEXT DEFAULT NULL
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
  _guardian_trimmed  TEXT;
  _student_id        UUID;
  _age_years         INTEGER;
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

  IF _birth_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data de nascimento.'
      USING ERRCODE = 'P0001';
  END IF;

  IF _birth_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'A data de nascimento não pode ser futura.'
      USING ERRCODE = 'P0001';
  END IF;

  _age_years := EXTRACT(YEAR FROM age(CURRENT_DATE, _birth_date))::INTEGER;
  IF _age_years > 100 THEN
    RAISE EXCEPTION 'Confira a data de nascimento informada.'
      USING ERRCODE = 'P0001';
  END IF;

  _guardian_trimmed := NULLIF(left(btrim(COALESCE(_guardian_name, '')), 120), '');
  IF _age_years < 18 AND _guardian_trimmed IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do responsável para alunos menores de idade.'
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
    plan_id,
    birth_date,
    guardian_name
  )
  VALUES (
    _academy_id,
    _user_id,
    _full_name_trimmed,
    _clean_wa,
    _belt_val,
    0,
    'pendente_aprovacao'::public.student_status,
    _plan_id,
    _birth_date,
    _guardian_trimmed
  )
  ON CONFLICT (profile_user_id) DO UPDATE
    SET academy_id    = EXCLUDED.academy_id,
        full_name     = EXCLUDED.full_name,
        whatsapp      = EXCLUDED.whatsapp,
        belt          = EXCLUDED.belt,
        plan_id       = EXCLUDED.plan_id,
        birth_date    = EXCLUDED.birth_date,
        guardian_name = EXCLUDED.guardian_name,
        status        = 'pendente_aprovacao'::public.student_status,
        updated_at    = now();

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

REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT) TO service_role;
