-- ================================================================
-- FAITH BROTHERS — Phase 3: public plans flags + registration intent
-- Additive. Does NOT enable flags. Does NOT touch production until push.
-- ================================================================

-- ---------------------------------------------------------------------------
-- 1) Public academies include feature flags (safe booleans only)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_academies();

CREATE OR REPLACE FUNCTION public.get_public_academies()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  prepaid_contracts_enabled BOOLEAN,
  family_plans_enabled BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.name,
    a.slug,
    COALESCE(s.prepaid_contracts_enabled, FALSE) AS prepaid_contracts_enabled,
    COALESCE(s.family_plans_enabled, FALSE) AS family_plans_enabled
  FROM public.academies a
  LEFT JOIN public.academy_billing_settings s ON s.academy_id = a.id
  ORDER BY a.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_academies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_academies() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Public plans expose prepaid metadata; filter by flags
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_public_active_plans(UUID);

CREATE OR REPLACE FUNCTION public.get_public_active_plans(_academy_id UUID)
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
  ORDER BY
    CASE COALESCE(p.billing_mode, 'asaas_monthly')
      WHEN 'asaas_monthly' THEN 0
      WHEN 'machine_prepaid' THEN 1
      ELSE 2
    END,
    p.monthly_price ASC,
    p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_active_plans(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_active_plans(UUID) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Registration atomic with prepaid / family intent
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_student_registration_atomic(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT);

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
  _financial_responsible_email TEXT DEFAULT NULL
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

  -- Tax ID: required for individual / family creator; optional for family joiner
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

  IF COALESCE(_plan.billing_mode, 'asaas_monthly') IN ('machine_prepaid', 'machine_dropin') THEN
    _method := NULLIF(btrim(COALESCE(_payment_method, '')), '');
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
  ELSE
    _method := NULL;
    _installments_final := NULL;
    _review_status := 'nao_aplicavel';
  END IF;

  -- Family group pending
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
    pending_family_invite_code
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
    _guardian_trimmed,
    _method,
    _installments_final,
    _review_status,
    _family_id,
    CASE WHEN _contract_type_final = 'familiar' AND _family_mode_final = 'create' THEN _invite ELSE NULL END
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
  TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_student_registration_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT,
  TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Block simple approve for prepaid awaiting payment (admin must use RPC)
-- ---------------------------------------------------------------------------
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id, s.status, s.payment_review_status
  INTO _academy_id, _current_status, _review
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
      'Pacote antecipado: use “Pagamento aprovado e meses liberados” (ou família). Aprovação simples não libera meses.'
      USING ERRCODE = 'P0001';
  END IF;

  IF _approve IS TRUE AND NOT public.is_admin_only(_academy_id) THEN
    -- Keep professor able to approve only classic monthly Asaas path
    IF COALESCE(_review, 'nao_aplicavel') <> 'nao_aplicavel' THEN
      RAISE EXCEPTION 'Somente administrador pode processar cadastro com pagamento antecipado'
        USING ERRCODE = 'P0001';
    END IF;
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
