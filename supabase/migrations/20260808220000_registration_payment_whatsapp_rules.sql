-- ================================================================
-- Faith Brothers — Registration payment + WhatsApp rules
-- Additive. new_student vs veterano, card never auto-paid, WA keys.
-- ================================================================

-- 1) Audience: allow new_student
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_audience_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_audience_check
  CHECK (audience IN ('normal', 'new_student', 'veterano', 'familia', 'outro'));

-- Tag classic monthly plans as new_student (idempotent)
UPDATE public.plans
SET audience = 'new_student',
    updated_at = now()
WHERE COALESCE(billing_mode, 'asaas_monthly') = 'asaas_monthly'
  AND COALESCE(audience, 'normal') IN ('normal', 'new_student')
  AND (
    name ILIKE 'Plano % dias%'
    OR name ILIKE 'Plano %dia%'
  );

-- Seed anual veteran packages (2/3/5) — idempotent by name
INSERT INTO public.plans (
  academy_id, name, monthly_price, training_days_per_week, active,
  category, audience, plan_kind, duration_months,
  reference_monthly_price, package_total_amount,
  billing_mode, allows_installments, max_installments, description
)
SELECT
  a.id,
  v.name,
  v.reference_monthly_price,
  v.days,
  TRUE,
  'veterano',
  'veterano',
  v.plan_kind,
  v.duration_months,
  v.reference_monthly_price,
  v.package_total_amount,
  'machine_prepaid',
  TRUE,
  v.max_installments,
  v.description
FROM public.academies a
CROSS JOIN (
  VALUES
    ('Pacote Anual Veterano 5 dias'::text, 5, 180.00::numeric, 2160.00::numeric, 12, 'anual'::text, 12, 'Pacote antecipado de 12 meses. Cartão só na maquininha — ADM confirma.'),
    ('Pacote Anual Veterano 3 dias', 3, 150.00, 1800.00, 12, 'anual', 12, 'Pacote antecipado de 12 meses. Cartão só na maquininha — ADM confirma.'),
    ('Pacote Anual Veterano 2 dias', 2, 120.00, 1440.00, 12, 'anual', 12, 'Pacote antecipado de 12 meses. Cartão só na maquininha — ADM confirma.')
) AS v(name, days, reference_monthly_price, package_total_amount, duration_months, plan_kind, max_installments, description)
ON CONFLICT (academy_id, name) DO UPDATE
SET
  monthly_price = EXCLUDED.monthly_price,
  training_days_per_week = EXCLUDED.training_days_per_week,
  active = TRUE,
  audience = 'veterano',
  plan_kind = EXCLUDED.plan_kind,
  duration_months = EXCLUDED.duration_months,
  reference_monthly_price = EXCLUDED.reference_monthly_price,
  package_total_amount = EXCLUDED.package_total_amount,
  billing_mode = 'machine_prepaid',
  allows_installments = TRUE,
  max_installments = EXCLUDED.max_installments,
  description = EXCLUDED.description,
  updated_at = now();

-- 2) Student registration flow columns
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS registration_audience TEXT,
  ADD COLUMN IF NOT EXISTS requested_training_days INTEGER,
  ADD COLUMN IF NOT EXISTS requested_billing_period TEXT,
  ADD COLUMN IF NOT EXISTS billing_period_status TEXT NOT NULL DEFAULT 'nao_aplicavel';

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_registration_audience_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_registration_audience_check
  CHECK (
    registration_audience IS NULL
    OR registration_audience IN ('new_student', 'veterano')
  );

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_requested_training_days_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_requested_training_days_check
  CHECK (
    requested_training_days IS NULL
    OR requested_training_days IN (2, 3, 5)
  );

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_requested_billing_period_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_requested_billing_period_check
  CHECK (
    requested_billing_period IS NULL
    OR requested_billing_period IN ('mensal', 'semestral', 'anual')
  );

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_billing_period_status_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_billing_period_status_check
  CHECK (
    billing_period_status IN (
      'nao_aplicavel', 'aguardando_escolha', 'escolhido'
    )
  );

-- Allow boleto intent on requested_payment_method (text, no enum)

-- 3) Public plans filtered by audience
DROP FUNCTION IF EXISTS public.get_public_active_plans(UUID);
DROP FUNCTION IF EXISTS public.get_public_active_plans(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.get_public_active_plans(
  _academy_id UUID,
  _audience TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  monthly_price NUMERIC,
  training_days_per_week INTEGER,
  audience TEXT,
  plan_kind TEXT,
  duration_months INTEGER,
  reference_monthly_price NUMERIC,
  package_total_amount NUMERIC,
  billing_mode TEXT,
  allows_installments BOOLEAN,
  max_installments INTEGER,
  description TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH flags AS (
    SELECT
      COALESCE(s.prepaid_contracts_enabled, FALSE) AS prepaid_on,
      COALESCE(s.family_plans_enabled, FALSE) AS family_on
    FROM public.academy_billing_settings s
    WHERE s.academy_id = _academy_id
    UNION ALL
    SELECT FALSE, FALSE
    WHERE NOT EXISTS (
      SELECT 1 FROM public.academy_billing_settings s WHERE s.academy_id = _academy_id
    )
    LIMIT 1
  )
  SELECT
    p.id,
    p.name,
    p.monthly_price,
    p.training_days_per_week,
    COALESCE(p.audience, 'normal') AS audience,
    COALESCE(p.plan_kind, 'mensal') AS plan_kind,
    COALESCE(p.duration_months, 1) AS duration_months,
    COALESCE(p.reference_monthly_price, p.monthly_price) AS reference_monthly_price,
    p.package_total_amount,
    COALESCE(p.billing_mode, 'asaas_monthly') AS billing_mode,
    COALESCE(p.allows_installments, FALSE) AS allows_installments,
    COALESCE(p.max_installments, 1) AS max_installments,
    p.description
  FROM public.plans p
  CROSS JOIN flags f
  WHERE p.academy_id = _academy_id
    AND p.active = TRUE
    AND (
      COALESCE(p.billing_mode, 'asaas_monthly') = 'asaas_monthly'
      OR (f.prepaid_on AND COALESCE(p.billing_mode, 'asaas_monthly') IN ('machine_prepaid', 'machine_dropin'))
    )
    AND (
      COALESCE(p.audience, 'normal') <> 'familia'
      OR f.family_on
    )
    AND (
      _audience IS NULL
      OR (
        _audience = 'new_student'
        AND COALESCE(p.audience, 'normal') IN ('new_student', 'normal')
        AND COALESCE(p.billing_mode, 'asaas_monthly') = 'asaas_monthly'
      )
      OR (
        _audience = 'veterano'
        AND COALESCE(p.audience, 'normal') = 'veterano'
      )
      OR (
        _audience = 'familia'
        AND COALESCE(p.audience, 'normal') = 'familia'
      )
    )
  ORDER BY
    CASE COALESCE(p.billing_mode, 'asaas_monthly')
      WHEN 'asaas_monthly' THEN 0
      WHEN 'machine_prepaid' THEN 1
      ELSE 2
    END,
    p.monthly_price ASC,
    p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_active_plans(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_active_plans(UUID, TEXT) TO anon, authenticated, service_role;

-- 4) Registration atomic — extend with audience / days
DROP FUNCTION IF EXISTS public.complete_student_registration_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT,
  TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.complete_student_registration_atomic(
  _user_id UUID,
  _academy_id UUID,
  _full_name TEXT,
  _whatsapp TEXT,
  _belt TEXT DEFAULT 'Branca',
  _tax_id TEXT DEFAULT NULL,
  _plan_id UUID DEFAULT NULL,
  _birth_date DATE DEFAULT NULL,
  _guardian_name TEXT DEFAULT NULL,
  _payment_method TEXT DEFAULT NULL,
  _installments INTEGER DEFAULT NULL,
  _contract_type TEXT DEFAULT 'individual',
  _family_mode TEXT DEFAULT NULL,
  _family_name TEXT DEFAULT NULL,
  _family_invite_code TEXT DEFAULT NULL,
  _family_relationship TEXT DEFAULT 'integrante',
  _estimated_member_count INTEGER DEFAULT NULL,
  _financial_responsible_name TEXT DEFAULT NULL,
  _financial_responsible_phone TEXT DEFAULT NULL,
  _financial_responsible_email TEXT DEFAULT NULL,
  _registration_audience TEXT DEFAULT NULL,
  _requested_training_days INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean_wa TEXT;
  _clean_tax TEXT;
  _full_name_trimmed TEXT;
  _belt_val TEXT;
  _guardian_trimmed TEXT;
  _student_id UUID;
  _age_years INTEGER;
  _plan public.plans%ROWTYPE;
  _prepaid_on BOOLEAN := FALSE;
  _family_on BOOLEAN := FALSE;
  _review_status TEXT := 'nao_aplicavel';
  _method TEXT;
  _installments_final INTEGER;
  _contract_type_final TEXT := COALESCE(NULLIF(btrim(_contract_type), ''), 'individual');
  _family_mode_final TEXT := NULLIF(btrim(COALESCE(_family_mode, '')), '');
  _family_id UUID;
  _invite TEXT;
  _resp_name TEXT;
  _audience TEXT := NULLIF(btrim(COALESCE(_registration_audience, '')), '');
  _days INTEGER := _requested_training_days;
  _period_status TEXT := 'nao_aplicavel';
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id obrigatório' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Usuário de autenticação não encontrado' USING ERRCODE = 'P0001';
  END IF;

  _full_name_trimmed := left(btrim(_full_name), 120);
  IF _full_name_trimmed IS NULL OR _full_name_trimmed = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório' USING ERRCODE = 'P0001';
  END IF;

  _clean_wa := regexp_replace(btrim(COALESCE(_whatsapp, '')), '[^0-9]', '', 'g');
  IF length(_clean_wa) >= 12 AND _clean_wa LIKE '55%' THEN
    _clean_wa := substring(_clean_wa FROM 3);
  END IF;
  IF _clean_wa !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'WhatsApp inválido. Informe 11 dígitos com DDD.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.academies WHERE id = _academy_id) THEN
    RAISE EXCEPTION 'Academia inválida' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    COALESCE(s.prepaid_contracts_enabled, FALSE),
    COALESCE(s.family_plans_enabled, FALSE)
  INTO _prepaid_on, _family_on
  FROM public.academy_billing_settings s
  WHERE s.academy_id = _academy_id;

  IF _audience IS NOT NULL AND _audience NOT IN ('new_student', 'veterano') THEN
    RAISE EXCEPTION 'Público de cadastro inválido.' USING ERRCODE = 'P0001';
  END IF;

  -- Default individual without explicit audience → new_student when plan is monthly
  IF _audience IS NULL AND _contract_type_final = 'individual' THEN
    _audience := 'new_student';
  END IF;

  IF _audience = 'veterano' THEN
    IF _days IS NULL OR _days NOT IN (2, 3, 5) THEN
      RAISE EXCEPTION 'Veterano: escolha 2, 3 ou 5 dias por semana.' USING ERRCODE = 'P0001';
    END IF;
    _plan_id := NULL;
    _method := NULL;
    _installments_final := NULL;
    _review_status := 'nao_aplicavel';
    _period_status := 'nao_aplicavel';
  ELSE
    IF _plan_id IS NULL THEN
      RAISE EXCEPTION 'Selecione um plano desejado.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO _plan
    FROM public.plans p
    WHERE p.id = _plan_id AND p.academy_id = _academy_id AND p.active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Plano inválido ou inativo para esta academia.' USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(_plan.billing_mode, 'asaas_monthly') <> 'asaas_monthly' AND NOT _prepaid_on THEN
      RAISE EXCEPTION 'Pacotes antecipados não estão habilitados para esta academia.' USING ERRCODE = 'P0001';
    END IF;

    IF _audience = 'new_student'
       AND COALESCE(_plan.audience, 'normal') NOT IN ('new_student', 'normal') THEN
      RAISE EXCEPTION 'Plano não destinado a novo aluno / iniciante.' USING ERRCODE = 'P0001';
    END IF;

    _method := NULLIF(btrim(COALESCE(_payment_method, '')), '');

    IF COALESCE(_plan.billing_mode, 'asaas_monthly') IN ('machine_prepaid', 'machine_dropin') THEN
      IF _method IS NULL OR _method NOT IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
        RAISE EXCEPTION 'Informe a forma de pagamento do pacote.' USING ERRCODE = 'P0001';
      END IF;
      _installments_final := COALESCE(_installments, 1);
      IF _method <> 'cartao_credito' THEN
        _installments_final := 1;
      ELSIF COALESCE(_plan.allows_installments, FALSE) IS NOT TRUE THEN
        _installments_final := 1;
      ELSIF _installments_final < 1 OR _installments_final > COALESCE(_plan.max_installments, 1) THEN
        RAISE EXCEPTION 'Quantidade de parcelas inválida para este plano.' USING ERRCODE = 'P0001';
      END IF;
      _review_status := 'aguardando_conferencia';
    ELSIF _audience = 'new_student' THEN
      -- Monthly new student: boleto (Asaas) OR physical machine methods
      IF _method IS NULL OR _method NOT IN ('boleto', 'cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
        RAISE EXCEPTION 'Informe a forma de pagamento (boleto ou maquininha).' USING ERRCODE = 'P0001';
      END IF;
      IF _method = 'boleto' THEN
        _installments_final := NULL;
        _review_status := 'nao_aplicavel';
      ELSE
        _installments_final := COALESCE(_installments, 1);
        IF _method <> 'cartao_credito' THEN
          _installments_final := 1;
        ELSIF _installments_final < 1 OR _installments_final > 12 THEN
          RAISE EXCEPTION 'Quantidade de parcelas inválida.' USING ERRCODE = 'P0001';
        END IF;
        -- Card/machine: never paid until ADM confirms
        _review_status := 'aguardando_conferencia';
      END IF;
    ELSE
      _method := NULL;
      _installments_final := NULL;
      _review_status := 'nao_aplicavel';
    END IF;
  END IF;

  IF _contract_type_final NOT IN ('individual', 'familiar') THEN
    RAISE EXCEPTION 'Tipo de contrato inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF _contract_type_final = 'familiar' AND NOT _family_on THEN
    RAISE EXCEPTION 'Plano familiar não está habilitado para esta academia.' USING ERRCODE = 'P0001';
  END IF;

  IF _birth_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data de nascimento.' USING ERRCODE = 'P0001';
  END IF;
  IF _birth_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'A data de nascimento não pode ser futura.' USING ERRCODE = 'P0001';
  END IF;

  _age_years := EXTRACT(YEAR FROM age(CURRENT_DATE, _birth_date))::INTEGER;
  IF _age_years > 100 THEN
    RAISE EXCEPTION 'Confira a data de nascimento informada.' USING ERRCODE = 'P0001';
  END IF;

  _guardian_trimmed := NULLIF(left(btrim(COALESCE(_guardian_name, '')), 120), '');
  IF _age_years < 18 AND _guardian_trimmed IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do responsável para alunos menores de idade.' USING ERRCODE = 'P0001';
  END IF;

  _clean_tax := public.normalize_tax_id(_tax_id);
  IF NOT (
    _contract_type_final = 'familiar'
    AND _family_mode_final = 'join'
  ) THEN
    IF _clean_tax IS NULL OR NOT public.is_valid_tax_id(_clean_tax) THEN
      RAISE EXCEPTION 'CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF _clean_tax IS NOT NULL AND _clean_tax <> '' AND NOT public.is_valid_tax_id(_clean_tax) THEN
    RAISE EXCEPTION 'CPF ou CNPJ inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role IN ('admin', 'professor')
  ) THEN
    RAISE EXCEPTION 'Este usuário já possui papel de equipe' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE regexp_replace(btrim(COALESCE(p.whatsapp, '')), '[^0-9]', '', 'g') = _clean_wa
      AND p.user_id <> _user_id
  ) THEN
    RAISE EXCEPTION 'Este WhatsApp já está cadastrado.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students s
    WHERE regexp_replace(btrim(s.whatsapp), '[^0-9]', '', 'g') = _clean_wa
      AND s.profile_user_id IS DISTINCT FROM _user_id
  ) THEN
    RAISE EXCEPTION 'Este WhatsApp já está cadastrado.' USING ERRCODE = '23505';
  END IF;

  IF _clean_tax IS NOT NULL AND _clean_tax <> '' AND EXISTS (
    SELECT 1 FROM public.student_billing_profiles sbp WHERE sbp.tax_id = _clean_tax
  ) THEN
    RAISE EXCEPTION 'Este CPF/CNPJ já está cadastrado.' USING ERRCODE = '23505';
  END IF;

  _belt_val := COALESCE(NULLIF(btrim(COALESCE(_belt, '')), ''), 'Branca');

  IF _contract_type_final = 'familiar' THEN
    IF _family_mode_final = 'create' THEN
      _resp_name := COALESCE(
        NULLIF(left(btrim(COALESCE(_financial_responsible_name, '')), 120), ''),
        _full_name_trimmed
      );
      _invite := public.generate_family_invite_code();
      INSERT INTO public.family_groups (
        academy_id, name, invite_code,
        financial_responsible_name,
        financial_responsible_tax_id,
        financial_responsible_phone,
        financial_responsible_email,
        estimated_member_count,
        status
      ) VALUES (
        _academy_id,
        COALESCE(NULLIF(left(btrim(COALESCE(_family_name, '')), 120), ''), 'Família ' || _resp_name),
        _invite,
        _resp_name,
        _clean_tax,
        NULLIF(regexp_replace(btrim(COALESCE(_financial_responsible_phone, _clean_wa)), '[^0-9]', '', 'g'), ''),
        NULLIF(left(btrim(COALESCE(_financial_responsible_email, '')), 160), ''),
        CASE WHEN _estimated_member_count IS NULL OR _estimated_member_count < 1 THEN 3 ELSE _estimated_member_count END,
        'pendente'
      )
      RETURNING id INTO _family_id;
    ELSIF _family_mode_final = 'join' THEN
      _invite := upper(btrim(COALESCE(_family_invite_code, '')));
      IF length(_invite) < 4 THEN
        RAISE EXCEPTION 'Informe o código familiar para entrar no grupo.' USING ERRCODE = 'P0001';
      END IF;
      SELECT g.id INTO _family_id
      FROM public.family_groups g
      WHERE g.academy_id = _academy_id
        AND g.invite_code = _invite
        AND g.status IN ('pendente', 'ativo')
      LIMIT 1;
      IF _family_id IS NULL THEN
        RAISE EXCEPTION 'Código familiar inválido ou grupo inativo.' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      RAISE EXCEPTION 'Informe se deseja criar ou entrar em uma família.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

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
    guardian_name,
    requested_payment_method,
    requested_installments,
    payment_review_status,
    pending_family_group_id,
    pending_family_invite_code,
    registration_audience,
    requested_training_days,
    requested_billing_period,
    billing_period_status
  ) VALUES (
    _academy_id,
    _user_id,
    _full_name_trimmed,
    _clean_wa,
    _belt_val,
    0,
    'pendente_aprovacao'::public.student_status,
    _plan_id,
    _birth_date,
    _guardian_trimmed,
    _method,
    _installments_final,
    _review_status,
    _family_id,
    CASE WHEN _family_id IS NOT NULL THEN _invite ELSE NULL END,
    _audience,
    _days,
    NULL,
    _period_status
  )
  ON CONFLICT (profile_user_id) DO UPDATE
    SET academy_id = EXCLUDED.academy_id,
        full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        belt = EXCLUDED.belt,
        plan_id = EXCLUDED.plan_id,
        birth_date = EXCLUDED.birth_date,
        guardian_name = EXCLUDED.guardian_name,
        requested_payment_method = EXCLUDED.requested_payment_method,
        requested_installments = EXCLUDED.requested_installments,
        payment_review_status = EXCLUDED.payment_review_status,
        pending_family_group_id = EXCLUDED.pending_family_group_id,
        pending_family_invite_code = EXCLUDED.pending_family_invite_code,
        registration_audience = EXCLUDED.registration_audience,
        requested_training_days = EXCLUDED.requested_training_days,
        requested_billing_period = EXCLUDED.requested_billing_period,
        billing_period_status = EXCLUDED.billing_period_status,
        status = 'pendente_aprovacao'::public.student_status,
        updated_at = now();

  SELECT s.id INTO _student_id
  FROM public.students s
  WHERE s.profile_user_id = _user_id
  LIMIT 1;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'Não foi possível criar o registro do aluno' USING ERRCODE = 'P0001';
  END IF;

  IF _clean_tax IS NOT NULL AND _clean_tax <> '' THEN
    INSERT INTO public.student_billing_profiles (student_id, tax_id)
    VALUES (_student_id, _clean_tax)
    ON CONFLICT (student_id) DO UPDATE
      SET tax_id = EXCLUDED.tax_id,
          updated_at = now();
  END IF;

  IF _family_id IS NOT NULL THEN
    IF _family_mode_final = 'create' THEN
      UPDATE public.family_groups
      SET financial_responsible_student_id = _student_id,
          updated_at = now()
      WHERE id = _family_id;
    END IF;

    INSERT INTO public.family_members (
      family_group_id, student_id, relationship, status, joined_at
    ) VALUES (
      _family_id,
      _student_id,
      COALESCE(NULLIF(left(btrim(COALESCE(_family_relationship, '')), 40), ''), 'integrante'),
      'pendente',
      NULL
    )
    ON CONFLICT (family_group_id, student_id) DO UPDATE
      SET relationship = EXCLUDED.relationship,
          status = 'pendente',
          updated_at = now();
  END IF;

  RETURN _student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT,
  TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_student_registration_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT,
  TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
) TO service_role;

-- 5) approve_student: veteran → aguardando escolha de período; card still blocked
CREATE OR REPLACE FUNCTION public.approve_student(
  _student_id UUID,
  _approve BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy_id UUID;
  _current_status public.student_status;
  _new_status public.student_status;
  _review TEXT;
  _audience TEXT;
  _period_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id, s.status, s.payment_review_status,
         s.registration_audience, s.billing_period_status
  INTO _academy_id, _current_status, _review, _audience, _period_status
  FROM public.students s
  WHERE s.id = _student_id;

  IF _academy_id IS NULL THEN
    RAISE EXCEPTION 'Aluno não encontrado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid()
      AND p.academy_id = _academy_id
      AND ur.role IN ('admin', 'professor')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: somente admin ou professor da academia pode aprovar alunos'
      USING ERRCODE = 'P0001';
  END IF;

  IF _current_status IS DISTINCT FROM 'pendente_aprovacao'::public.student_status THEN
    RAISE EXCEPTION 'Aluno não está pendente de aprovação (status atual: %)', _current_status
      USING ERRCODE = 'P0001';
  END IF;

  IF _approve IS TRUE AND COALESCE(_review, 'nao_aplicavel') = 'aguardando_conferencia' THEN
    RAISE EXCEPTION
      'Pagamento na maquininha: use “Pagamento aprovado”. Aprovação simples não libera o plano.'
      USING ERRCODE = 'P0001';
  END IF;

  IF _approve IS TRUE AND NOT public.is_admin_only(_academy_id) THEN
    IF COALESCE(_review, 'nao_aplicavel') <> 'nao_aplicavel' THEN
      RAISE EXCEPTION 'Somente administrador pode processar cadastro com pagamento antecipado'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Veterano: aprovação do cadastro → aguarda escolha mensal/semestral/anual (não ativa ainda)
  IF _approve IS TRUE AND COALESCE(_audience, '') = 'veterano' THEN
    UPDATE public.students
    SET billing_period_status = 'aguardando_escolha',
        updated_at = now()
    WHERE id = _student_id
      AND status = 'pendente_aprovacao'::public.student_status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  _new_status := CASE
    WHEN _approve THEN 'ativo'::public.student_status
    ELSE 'rejeitado'::public.student_status
  END;

  UPDATE public.students
  SET status = _new_status,
      payment_review_status = CASE
        WHEN _approve THEN payment_review_status
        WHEN COALESCE(payment_review_status, 'nao_aplicavel') = 'aguardando_conferencia' THEN 'recusado'
        ELSE payment_review_status
      END,
      updated_at = now()
  WHERE id = _student_id
    AND status = 'pendente_aprovacao'::public.student_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- 6) ADM sets veteran billing period after approval request
CREATE OR REPLACE FUNCTION public.set_veteran_billing_period(
  _student_id UUID,
  _period TEXT,
  _payment_method TEXT DEFAULT NULL,
  _installments INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _student public.students%ROWTYPE;
  _plan public.plans%ROWTYPE;
  _days INTEGER;
  _method TEXT;
  _installments_final INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _student FROM public.students WHERE id = _student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado';
  END IF;

  IF NOT public.is_admin_only(_student.academy_id) THEN
    RAISE EXCEPTION 'Somente administrador pode definir a modalidade do veterano';
  END IF;

  IF COALESCE(_student.registration_audience, '') <> 'veterano' THEN
    RAISE EXCEPTION 'Aluno não é cadastro veterano';
  END IF;

  IF _student.billing_period_status NOT IN ('aguardando_escolha', 'escolhido') THEN
    RAISE EXCEPTION 'Aprove o cadastro do veterano antes de definir mensal/semestral/anual';
  END IF;

  IF _period NOT IN ('mensal', 'semestral', 'anual') THEN
    RAISE EXCEPTION 'Modalidade inválida';
  END IF;

  _days := _student.requested_training_days;
  IF _days IS NULL OR _days NOT IN (2, 3, 5) THEN
    RAISE EXCEPTION 'Dias de treino do veterano inválidos';
  END IF;

  IF _period = 'mensal' THEN
    SELECT * INTO _plan
    FROM public.plans p
    WHERE p.academy_id = _student.academy_id
      AND p.active = TRUE
      AND COALESCE(p.billing_mode, 'asaas_monthly') = 'asaas_monthly'
      AND COALESCE(p.audience, 'normal') IN ('new_student', 'normal')
      AND p.training_days_per_week = _days
    ORDER BY p.monthly_price ASC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não há plano mensal (%) dias configurado', _days;
    END IF;

    _method := 'boleto';
    _installments_final := NULL;

    UPDATE public.students
    SET
      plan_id = _plan.id,
      requested_billing_period = 'mensal',
      billing_period_status = 'escolhido',
      requested_payment_method = _method,
      requested_installments = NULL,
      payment_review_status = 'nao_aplicavel',
      status = 'ativo',
      updated_at = now()
    WHERE id = _student_id;

    RETURN _plan.id;
  END IF;

  -- semestral / anual → machine prepaid; never auto-paid
  SELECT * INTO _plan
  FROM public.plans p
  WHERE p.academy_id = _student.academy_id
    AND p.active = TRUE
    AND COALESCE(p.audience, '') = 'veterano'
    AND COALESCE(p.billing_mode, '') = 'machine_prepaid'
    AND p.training_days_per_week = _days
    AND (
      COALESCE(p.plan_kind, '') = _period
      OR p.duration_months = CASE WHEN _period = 'semestral' THEN 6 ELSE 12 END
    )
  ORDER BY p.duration_months DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há pacote % (%) dias configurado', _period, _days;
  END IF;

  _method := NULLIF(btrim(COALESCE(_payment_method, _student.requested_payment_method, '')), '');
  IF _method IS NULL OR _method NOT IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
    _method := 'cartao_credito';
  END IF;
  _installments_final := COALESCE(_installments, _student.requested_installments, 1);
  IF _method <> 'cartao_credito' THEN
    _installments_final := 1;
  END IF;

  UPDATE public.students
  SET
    plan_id = _plan.id,
    requested_billing_period = _period,
    billing_period_status = 'escolhido',
    requested_payment_method = _method,
    requested_installments = _installments_final,
    payment_review_status = 'aguardando_conferencia',
    status = 'pendente_aprovacao',
    updated_at = now()
  WHERE id = _student_id;

  RETURN _plan.id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER) TO authenticated, service_role;

-- 7) Card confirmation also for asaas_monthly (1 month coverage) — ADM only
CREATE OR REPLACE FUNCTION public.confirm_individual_prepaid_payment(
  _student_id UUID,
  _plan_id UUID,
  _starts_on DATE,
  _payment_method TEXT,
  _installments INTEGER,
  _total_amount NUMERIC DEFAULT NULL,
  _machine_reference TEXT DEFAULT NULL,
  _notes TEXT DEFAULT NULL,
  _confirmation_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _student public.students%ROWTYPE;
  _plan public.plans%ROWTYPE;
  _contract_id UUID;
  _ends DATE;
  _months DATE[];
  _month DATE;
  _amount NUMERIC(10,2);
  _installments_final INTEGER;
  _duration INTEGER;
BEGIN
  SELECT * INTO _student FROM public.students WHERE id = _student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado';
  END IF;

  IF NOT public.is_admin_only(_student.academy_id) THEN
    RAISE EXCEPTION 'Apenas administrador pode confirmar pagamento';
  END IF;

  SELECT * INTO _plan FROM public.plans WHERE id = _plan_id AND academy_id = _student.academy_id;
  IF NOT FOUND OR _plan.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Plano inválido ou inativo';
  END IF;

  -- Global card rule: machine prepaid OR monthly plan with physical payment intent
  IF _plan.billing_mode NOT IN ('machine_prepaid', 'machine_dropin', 'asaas_monthly') THEN
    RAISE EXCEPTION 'Plano não permite confirmação manual de pagamento';
  END IF;

  IF _plan.billing_mode = 'asaas_monthly'
     AND COALESCE(_student.payment_review_status, '') <> 'aguardando_conferencia' THEN
    RAISE EXCEPTION 'Mensal Asaas sem intenção de maquininha não usa confirmação manual';
  END IF;

  IF _payment_method NOT IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;

  _installments_final := COALESCE(_installments, 1);
  IF _payment_method <> 'cartao_credito' THEN
    _installments_final := 1;
  ELSIF _plan.allows_installments IS NOT TRUE AND _plan.billing_mode <> 'asaas_monthly' THEN
    _installments_final := 1;
  ELSIF _installments_final < 1 OR _installments_final > COALESCE(NULLIF(_plan.max_installments, 0), 12) THEN
    RAISE EXCEPTION 'Quantidade de parcelas inválida para este plano';
  END IF;

  _amount := COALESCE(_total_amount, _plan.package_total_amount, _plan.monthly_price);
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Valor total inválido';
  END IF;

  SELECT c.id INTO _contract_id
  FROM public.student_contracts c
  WHERE c.student_id = _student_id
    AND c.contract_status = 'ativo'
    AND c.payment_status = 'pago'
  LIMIT 1;

  IF _contract_id IS NOT NULL THEN
    RETURN _contract_id;
  END IF;

  _duration := CASE
    WHEN COALESCE(_plan.duration_months, 0) > 0 THEN _plan.duration_months
    WHEN _plan.billing_mode = 'asaas_monthly' THEN 1
    ELSE 0
  END;

  _ends := public.prepaid_ends_on(_starts_on, _duration);
  _months := public.prepaid_coverage_months(_starts_on, _duration);

  INSERT INTO public.student_contracts (
    academy_id, student_id, family_group_id, plan_id,
    starts_on, ends_on, duration_months, weekly_frequency,
    reference_monthly_amount, total_amount,
    payment_method, installments,
    payment_status, contract_status,
    approved_at, approved_by,
    payment_confirmed_at, payment_confirmed_by,
    confirmation_meta
  ) VALUES (
    _student.academy_id, _student_id, NULL, _plan.id,
    _starts_on, _ends, _duration, _plan.training_days_per_week,
    COALESCE(_plan.reference_monthly_price, _plan.monthly_price), _amount,
    _payment_method, _installments_final,
    'pago',
    CASE WHEN _duration > 0 THEN 'ativo' ELSE 'expirado' END,
    now(), auth.uid(),
    now(), auth.uid(),
    COALESCE(_confirmation_meta, '{}'::jsonb) || jsonb_build_object('channel', 'machine_admin_confirm')
  )
  RETURNING id INTO _contract_id;

  INSERT INTO public.contract_payments (
    contract_id, amount, payment_method, installments,
    machine_reference, action, notes, confirmed_by, confirmation_meta
  ) VALUES (
    _contract_id, _amount, _payment_method, _installments_final,
    _machine_reference, 'confirm', _notes, auth.uid(), COALESCE(_confirmation_meta, '{}'::jsonb)
  );

  IF _duration > 0 THEN
    FOREACH _month IN ARRAY _months LOOP
      INSERT INTO public.student_contract_months (
        contract_id, student_id, academy_id, reference_month, status, source, paid_at
      ) VALUES (
        _contract_id, _student_id, _student.academy_id, _month, 'pago', 'individual', now()
      )
      ON CONFLICT (contract_id, student_id, reference_month) DO NOTHING;
    END LOOP;
  END IF;

  UPDATE public.students
  SET
    status = 'ativo',
    plan_id = _plan.id,
    payment_review_status = 'confirmado',
    requested_payment_method = _payment_method,
    requested_installments = _installments_final,
    billing_period_status = CASE
      WHEN billing_period_status = 'aguardando_escolha' THEN 'escolhido'
      ELSE billing_period_status
    END,
    updated_at = now()
  WHERE id = _student_id;

  RETURN _contract_id;
END;
$$;
