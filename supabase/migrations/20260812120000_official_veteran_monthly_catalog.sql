-- ================================================================
-- Official VETERAN catalog (LOCAL — not applied yet).
-- Mensal: price by frequency (2/3/5) via boleto Asaas.
-- Trimestral/Semestral/Anual: price by modality ONLY (frequency independent).
-- Totals = monthly_price × duration_months (validated in RPCs).
-- NEVER copies new_student prices onto audience=veterano.
-- ================================================================

-- 1) Deactivate legacy veteran seeds (day-matrix packages + avulso)
UPDATE public.plans
SET active = FALSE,
    updated_at = now()
WHERE audience = 'veterano'
  AND (
    COALESCE(plan_kind, '') IN ('trimestral', 'semestral', 'anual', 'avulso')
    OR name ILIKE '%Veterano%'
    OR name ILIKE 'Treino avulso veterano%'
  )
  AND COALESCE(plan_kind, '') <> 'mensal';

-- Keep any prior inactive monthly rows out of the way if names differ;
-- official monthly upsert below activates the three canonical SKUs.

-- 2) Official monthly veteran plans (Asaas boleto) — by frequency
WITH monthly_catalog(name, days, monthly_price) AS (
  VALUES
    ('Veterano Mensal — 2 dias por semana'::text, 2, 130.00::numeric),
    ('Veterano Mensal — 3 dias por semana', 3, 150.00),
    ('Veterano Mensal — 5 dias por semana', 5, 180.00)
)
INSERT INTO public.plans (
  academy_id, name, monthly_price, training_days_per_week, active,
  audience, plan_kind, duration_months, reference_monthly_price, package_total_amount,
  billing_mode, allows_installments, max_installments, category, description
)
SELECT
  a.id,
  c.name,
  c.monthly_price,
  c.days,
  TRUE,
  'veterano',
  'mensal',
  1,
  c.monthly_price,
  NULL,
  'asaas_monthly',
  FALSE,
  1,
  'mensalidade',
  'Catálogo oficial veterano mensal ' || c.days || ' dias (boleto)'
FROM public.academies a
CROSS JOIN monthly_catalog c
ON CONFLICT (academy_id, name) DO UPDATE
SET
  monthly_price = EXCLUDED.monthly_price,
  training_days_per_week = EXCLUDED.training_days_per_week,
  active = TRUE,
  audience = 'veterano',
  plan_kind = 'mensal',
  duration_months = 1,
  reference_monthly_price = EXCLUDED.reference_monthly_price,
  package_total_amount = NULL,
  billing_mode = 'asaas_monthly',
  allows_installments = FALSE,
  max_installments = 1,
  category = 'mensalidade',
  description = EXCLUDED.description,
  updated_at = now();

-- 3) Official prepaid fidelity plans — ONE row per modality (no 2/3/5 matrix)
-- Totals: 160×3=480 · 130×6=780 · 110×12=1320
WITH prepaid_catalog(
  name, plan_kind, duration_months, monthly_price, package_total
) AS (
  VALUES
    (
      'Veterano Trimestral — fidelidade (cartão)'::text,
      'trimestral'::text,
      3,
      160.00::numeric,
      480.00::numeric
    ),
    (
      'Veterano Semestral — fidelidade (cartão)',
      'semestral',
      6,
      130.00,
      780.00
    ),
    (
      'Veterano Anual — fidelidade (cartão)',
      'anual',
      12,
      110.00,
      1320.00
    )
)
INSERT INTO public.plans (
  academy_id, name, monthly_price, training_days_per_week, active,
  audience, plan_kind, duration_months, reference_monthly_price, package_total_amount,
  billing_mode, allows_installments, max_installments, category, description
)
SELECT
  a.id,
  c.name,
  c.monthly_price,
  NULL, -- frequency is student-requested, not priced on plan
  TRUE,
  'veterano',
  c.plan_kind,
  c.duration_months,
  c.monthly_price,
  c.package_total,
  'machine_prepaid',
  TRUE,
  12,
  'pacote',
  'Catálogo oficial veterano ' || c.plan_kind
    || ' R$' || trim(to_char(c.monthly_price, '999999990.00'))
    || '/mês · total R$' || trim(to_char(c.package_total, '999999990.00'))
    || ' (' || c.duration_months || ' meses)'
FROM public.academies a
CROSS JOIN prepaid_catalog c
WHERE c.package_total = (c.monthly_price * c.duration_months)
ON CONFLICT (academy_id, name) DO UPDATE
SET
  monthly_price = EXCLUDED.monthly_price,
  training_days_per_week = NULL,
  active = TRUE,
  audience = 'veterano',
  plan_kind = EXCLUDED.plan_kind,
  duration_months = EXCLUDED.duration_months,
  reference_monthly_price = EXCLUDED.reference_monthly_price,
  package_total_amount = EXCLUDED.package_total_amount,
  billing_mode = 'machine_prepaid',
  allows_installments = TRUE,
  max_installments = 12,
  category = 'pacote',
  description = EXCLUDED.description,
  updated_at = now();

-- Guard: refuse bad seed if math ever drifts
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.active = TRUE
      AND COALESCE(p.audience, '') = 'veterano'
      AND COALESCE(p.billing_mode, '') = 'machine_prepaid'
      AND COALESCE(p.plan_kind, '') IN ('trimestral', 'semestral', 'anual')
      AND COALESCE(p.package_total_amount, 0)
          <> (COALESCE(p.monthly_price, 0) * COALESCE(p.duration_months, 0))
  ) THEN
    RAISE EXCEPTION 'Veteran prepaid catalog totals must equal monthly_price × duration_months';
  END IF;
END $$;

-- 4) set_veteran_billing_period: mensal by days; prepaid by modality only
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
  _expected_total NUMERIC(10,2);
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
  IF _days IS NULL OR _days NOT IN (2, 3, 5) THEN
    RAISE EXCEPTION 'Dias de treino do veterano inválidos (use 2, 3 ou 5)';
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

  -- Prepaid: match by modality only (frequency stays on student.requested_training_days)
  SELECT * INTO _plan
  FROM public.plans p
  WHERE p.academy_id = _student.academy_id
    AND p.active = TRUE
    AND COALESCE(p.audience, '') = 'veterano'
    AND COALESCE(p.billing_mode, '') = 'machine_prepaid'
    AND (
      COALESCE(p.plan_kind, '') = _period
      OR COALESCE(p.duration_months, 0) = _duration
    )
    AND COALESCE(p.monthly_price, 0) > 0
    AND COALESCE(p.package_total_amount, 0) > 0
    AND COALESCE(p.duration_months, 0) = _duration
  ORDER BY
    CASE WHEN p.training_days_per_week IS NULL THEN 0 ELSE 1 END,
    p.package_total_amount ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valores dos planos veteranos ainda não configurados.'
      USING ERRCODE = 'P0001';
  END IF;

  _expected_total := ROUND(COALESCE(_plan.monthly_price, 0) * _duration, 2);
  IF ROUND(COALESCE(_plan.package_total_amount, 0), 2) <> _expected_total THEN
    RAISE EXCEPTION
      'Total contratual veterano inválido: esperado R$% (R$%/mês × % meses)',
      _expected_total, _plan.monthly_price, _duration
      USING ERRCODE = 'P0001';
  END IF;

  _method := NULLIF(btrim(COALESCE(_payment_method, '')), '');
  IF _method IS NULL OR _method NOT IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
    RAISE EXCEPTION 'Informe a forma de pagamento (cartão/pix/dinheiro)';
  END IF;

  IF _method = 'cartao_credito' THEN
    _installments_final := GREATEST(
      1,
      LEAST(COALESCE(_installments, 1), COALESCE(_plan.max_installments, 12))
    );
  ELSE
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

REVOKE ALL ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER) IS
  'ADM defines veteran plan after cadastral approval. Mensal=boleto by days 2/3/5; T/S/A=machine prepaid by modality only; totals must equal monthly×months.';

-- 5) Confirm prepaid: use student frequency for veterans; enforce catalog totals
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
  _expected_total NUMERIC(10,2);
  _installments_final INTEGER;
  _duration INTEGER;
  _weekly INTEGER;
BEGIN
  SELECT * INTO _student FROM public.students WHERE id = _student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado';
  END IF;

  IF NOT public.is_admin_only(_student.academy_id) THEN
    RAISE EXCEPTION 'Apenas administrador pode confirmar pagamento';
  END IF;

  IF _student.approved_at IS NULL THEN
    RAISE EXCEPTION 'Aprove o cadastro antes de confirmar o pagamento'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _plan FROM public.plans WHERE id = _plan_id AND academy_id = _student.academy_id;
  IF NOT FOUND OR _plan.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Plano inválido ou inativo';
  END IF;

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

  _duration := CASE
    WHEN COALESCE(_plan.duration_months, 0) > 0 THEN _plan.duration_months
    WHEN _plan.billing_mode = 'asaas_monthly' THEN 1
    ELSE 0
  END;

  -- Veteran prepaid: total must be monthly × months from catalog (ignore forged frontend totals)
  IF COALESCE(_plan.audience, '') = 'veterano'
     AND COALESCE(_plan.billing_mode, '') = 'machine_prepaid'
     AND _duration > 0 THEN
    _expected_total := ROUND(
      COALESCE(_plan.reference_monthly_price, _plan.monthly_price, 0) * _duration,
      2
    );
    IF ROUND(COALESCE(_plan.package_total_amount, 0), 2) <> _expected_total THEN
      RAISE EXCEPTION
        'Total contratual veterano inválido no catálogo: esperado R$%',
        _expected_total
        USING ERRCODE = 'P0001';
    END IF;
    IF _total_amount IS NOT NULL AND ROUND(_total_amount, 2) <> _expected_total THEN
      RAISE EXCEPTION
        'Total informado (R$%) difere do contrato oficial (R$%)',
        ROUND(_total_amount, 2), _expected_total
        USING ERRCODE = 'P0001';
    END IF;
    _amount := _expected_total;
  ELSE
    _amount := COALESCE(_total_amount, _plan.package_total_amount, _plan.monthly_price);
  END IF;

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

  _ends := public.prepaid_ends_on(_starts_on, _duration);
  _months := public.prepaid_coverage_months(_starts_on, _duration);

  -- Frequency: prefer student request (veteran signup); else plan days
  _weekly := COALESCE(_student.requested_training_days, _plan.training_days_per_week);

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
    _starts_on, _ends, _duration, _weekly,
    COALESCE(_plan.reference_monthly_price, _plan.monthly_price), _amount,
    _payment_method, _installments_final,
    'pago',
    CASE WHEN _duration > 0 THEN 'ativo' ELSE 'expirado' END,
    COALESCE(_student.approved_at, now()), COALESCE(_student.approved_by, auth.uid()),
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

REVOKE ALL ON FUNCTION public.confirm_individual_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_individual_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB
) TO authenticated, service_role;

COMMENT ON FUNCTION public.confirm_individual_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB
) IS
  'ADM confirms machine payment after cadastral approval. Veteran prepaid totals enforced as monthly×months; weekly_frequency from student request when set.';
