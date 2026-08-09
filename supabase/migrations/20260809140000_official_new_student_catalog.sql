-- Official NEW_STUDENT catalog (16 combinations). Additive only.
-- DO NOT apply to production until go-live authorization.
-- NEVER copies these prices to audience=veterano.

-- 1) Allow frequency 1/2/3/5 for veteran desired days
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_requested_training_days_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_requested_training_days_check
  CHECK (
    requested_training_days IS NULL
    OR requested_training_days IN (1, 2, 3, 5)
  );

-- 2) Deactivate unconfirmed veteran seed packages (0 students linked).
-- Official veteran matrix awaits client values; do not reuse new_student prices.
UPDATE public.plans
SET active = FALSE,
    updated_at = now()
WHERE audience = 'veterano'
  AND COALESCE(plan_kind, '') IN ('semestral', 'anual', 'avulso')
  AND name ILIKE '%Veterano%';

-- 3) Upsert official NEW_STUDENT matrix for every academy
WITH catalog(name, days, kind, duration, monthly_price, package_total, billing_mode, allows_installments, max_installments) AS (
  VALUES
    -- MENSAL
    ('Plano 1 dia por semana', 1, 'mensal', 1, 180.00, NULL::numeric, 'asaas_monthly', FALSE, 1),
    ('Plano 2 dias por semana', 2, 'mensal', 1, 210.00, NULL::numeric, 'asaas_monthly', FALSE, 1),
    ('Plano 3 dias por semana', 3, 'mensal', 1, 230.00, NULL::numeric, 'asaas_monthly', FALSE, 1),
    ('Plano 5 dias por semana', 5, 'mensal', 1, 250.00, NULL::numeric, 'asaas_monthly', FALSE, 1),
    -- TRIMESTRAL
    ('Plano Trimestral 1 dia por semana', 1, 'trimestral', 3, 160.00, 480.00, 'machine_prepaid', TRUE, 12),
    ('Plano Trimestral 2 dias por semana', 2, 'trimestral', 3, 180.00, 540.00, 'machine_prepaid', TRUE, 12),
    ('Plano Trimestral 3 dias por semana', 3, 'trimestral', 3, 210.00, 630.00, 'machine_prepaid', TRUE, 12),
    ('Plano Trimestral 5 dias por semana', 5, 'trimestral', 3, 230.00, 690.00, 'machine_prepaid', TRUE, 12),
    -- SEMESTRAL
    ('Plano Semestral 1 dia por semana', 1, 'semestral', 6, 165.00, 990.00, 'machine_prepaid', TRUE, 12),
    ('Plano Semestral 2 dias por semana', 2, 'semestral', 6, 192.50, 1155.00, 'machine_prepaid', TRUE, 12),
    ('Plano Semestral 3 dias por semana', 3, 'semestral', 6, 210.00, 1260.00, 'machine_prepaid', TRUE, 12),
    ('Plano Semestral 5 dias por semana', 5, 'semestral', 6, 225.00, 1350.00, 'machine_prepaid', TRUE, 12),
    -- ANUAL
    ('Plano Anual 1 dia por semana', 1, 'anual', 12, 165.00, 1980.00, 'machine_prepaid', TRUE, 12),
    ('Plano Anual 2 dias por semana', 2, 'anual', 12, 192.50, 2310.00, 'machine_prepaid', TRUE, 12),
    ('Plano Anual 3 dias por semana', 3, 'anual', 12, 208.3333, 2500.00, 'machine_prepaid', TRUE, 12),
    ('Plano Anual 5 dias por semana', 5, 'anual', 12, 229.1667, 2750.00, 'machine_prepaid', TRUE, 12)
)
INSERT INTO public.plans (
  academy_id, name, monthly_price, training_days_per_week, active,
  audience, plan_kind, duration_months, reference_monthly_price, package_total_amount,
  billing_mode, allows_installments, max_installments, category, description
)
SELECT
  a.id,
  c.name,
  ROUND(c.monthly_price::numeric, 2),
  c.days,
  TRUE,
  'new_student',
  c.kind,
  c.duration,
  ROUND(c.monthly_price::numeric, 2),
  c.package_total,
  c.billing_mode,
  c.allows_installments,
  c.max_installments,
  CASE WHEN c.kind = 'mensal' THEN 'mensalidade' ELSE 'pacote' END,
  'Catálogo oficial new_student ' || c.kind || ' ' || c.days || ' dias'
FROM public.academies a
CROSS JOIN catalog c
ON CONFLICT (academy_id, name) DO UPDATE
SET
  monthly_price = EXCLUDED.monthly_price,
  training_days_per_week = EXCLUDED.training_days_per_week,
  active = TRUE,
  audience = 'new_student',
  plan_kind = EXCLUDED.plan_kind,
  duration_months = EXCLUDED.duration_months,
  reference_monthly_price = EXCLUDED.reference_monthly_price,
  package_total_amount = EXCLUDED.package_total_amount,
  billing_mode = EXCLUDED.billing_mode,
  allows_installments = EXCLUDED.allows_installments,
  max_installments = EXCLUDED.max_installments,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  updated_at = now();

-- 4) Public plans RPC: new_student sees monthly + prepaid period packages
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
      COALESCE(
        (SELECT s.prepaid_contracts_enabled FROM public.academy_billing_settings s WHERE s.academy_id = _academy_id LIMIT 1),
        FALSE
      ) AS prepaid_on,
      COALESCE(
        (SELECT s.family_plans_enabled FROM public.academy_billing_settings s WHERE s.academy_id = _academy_id LIMIT 1),
        FALSE
      ) AS family_on
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
        AND COALESCE(p.audience, 'normal') <> 'veterano'
        AND (
          COALESCE(p.billing_mode, 'asaas_monthly') = 'asaas_monthly'
          OR (
            f.prepaid_on
            AND COALESCE(p.billing_mode, '') = 'machine_prepaid'
            AND COALESCE(p.plan_kind, '') IN ('trimestral', 'semestral', 'anual')
          )
        )
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
    CASE COALESCE(p.plan_kind, 'mensal')
      WHEN 'mensal' THEN 0
      WHEN 'trimestral' THEN 1
      WHEN 'semestral' THEN 2
      WHEN 'anual' THEN 3
      ELSE 4
    END,
    p.training_days_per_week ASC NULLS LAST,
    p.monthly_price ASC,
    p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_public_active_plans(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_active_plans(UUID, TEXT) TO anon, authenticated, service_role;

-- 5) Veteran billing period: allow 1 day; never use new_student prices
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
  _duration INTEGER;
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
    RAISE EXCEPTION 'Aprove o cadastro do veterano antes de definir plano e pagamento';
  END IF;

  IF _period NOT IN ('mensal', 'trimestral', 'semestral', 'anual') THEN
    RAISE EXCEPTION 'Modalidade inválida';
  END IF;

  _days := _student.requested_training_days;
  IF _days IS NULL OR _days NOT IN (1, 2, 3, 5) THEN
    RAISE EXCEPTION 'Dias de treino do veterano inválidos';
  END IF;

  _duration := CASE
    WHEN _period = 'mensal' THEN 1
    WHEN _period = 'trimestral' THEN 3
    WHEN _period = 'semestral' THEN 6
    ELSE 12
  END;

  IF _period = 'mensal' THEN
    SELECT * INTO _plan
    FROM public.plans p
    WHERE p.academy_id = _student.academy_id
      AND p.active = TRUE
      AND COALESCE(p.audience, '') = 'veterano'
      AND COALESCE(p.billing_mode, 'asaas_monthly') = 'asaas_monthly'
      AND p.training_days_per_week = _days
      AND (
        COALESCE(p.plan_kind, 'mensal') = 'mensal'
        OR COALESCE(p.duration_months, 1) = 1
      )
      AND COALESCE(p.monthly_price, 0) > 0
    ORDER BY p.monthly_price ASC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Valores dos planos veteranos ainda não configurados.'
        USING ERRCODE = 'P0001';
    END IF;

    _method := 'boleto';

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

  SELECT * INTO _plan
  FROM public.plans p
  WHERE p.academy_id = _student.academy_id
    AND p.active = TRUE
    AND COALESCE(p.audience, '') = 'veterano'
    AND COALESCE(p.billing_mode, '') = 'machine_prepaid'
    AND p.training_days_per_week = _days
    AND (
      COALESCE(p.plan_kind, '') = _period
      OR p.duration_months = _duration
    )
    AND COALESCE(p.package_total_amount, 0) > 0
  ORDER BY p.duration_months DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valores dos planos veteranos ainda não configurados.'
      USING ERRCODE = 'P0001';
  END IF;

  _method := NULLIF(btrim(COALESCE(_payment_method, _student.requested_payment_method, '')), '');
  IF _method IS NULL OR _method NOT IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
    _method := 'cartao_credito';
  END IF;

  _installments_final := COALESCE(_installments, _student.requested_installments, 1);
  IF _installments_final < 1 THEN
    _installments_final := 1;
  END IF;
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
    updated_at = now()
  WHERE id = _student_id;

  RETURN _plan.id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER) TO authenticated, service_role;


-- 6) Registration atomic: allow frequency 1
CREATE OR REPLACE FUNCTION public.complete_student_registration_atomic(_user_id uuid, _academy_id uuid, _full_name text, _whatsapp text, _belt text DEFAULT 'Branca'::text, _tax_id text DEFAULT NULL::text, _plan_id uuid DEFAULT NULL::uuid, _birth_date date DEFAULT NULL::date, _guardian_name text DEFAULT NULL::text, _payment_method text DEFAULT NULL::text, _installments integer DEFAULT NULL::integer, _contract_type text DEFAULT 'individual'::text, _family_mode text DEFAULT NULL::text, _family_name text DEFAULT NULL::text, _family_invite_code text DEFAULT NULL::text, _family_relationship text DEFAULT 'integrante'::text, _estimated_member_count integer DEFAULT NULL::integer, _financial_responsible_name text DEFAULT NULL::text, _financial_responsible_phone text DEFAULT NULL::text, _financial_responsible_email text DEFAULT NULL::text, _registration_audience text DEFAULT NULL::text, _requested_training_days integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
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
    IF _days IS NULL OR _days NOT IN (1, 2, 3, 5) THEN
      RAISE EXCEPTION 'Veterano: escolha 1, 2, 3 ou 5 dias por semana.' USING ERRCODE = 'P0001';
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
$function$

