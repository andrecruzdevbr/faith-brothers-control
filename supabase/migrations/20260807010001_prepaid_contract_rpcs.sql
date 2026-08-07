-- ================================================================
-- FAITH BROTHERS — Prepaid confirm / cancel RPCs (admin only)
-- ================================================================

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

  IF _plan.billing_mode NOT IN ('machine_prepaid', 'machine_dropin') THEN
    RAISE EXCEPTION 'Plano não é de pagamento antecipado na maquininha';
  END IF;

  IF _payment_method NOT IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;

  _installments_final := COALESCE(_installments, 1);
  IF _payment_method <> 'cartao_credito' THEN
    _installments_final := 1;
  ELSIF _plan.allows_installments IS NOT TRUE THEN
    _installments_final := 1;
  ELSIF _installments_final < 1 OR _installments_final > COALESCE(_plan.max_installments, 1) THEN
    RAISE EXCEPTION 'Quantidade de parcelas inválida para este plano';
  END IF;

  _amount := COALESCE(_total_amount, _plan.package_total_amount, _plan.monthly_price);
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Valor total inválido';
  END IF;

  -- Idempotency: already has active paid individual contract for same plan overlapping
  SELECT c.id INTO _contract_id
  FROM public.student_contracts c
  WHERE c.student_id = _student_id
    AND c.contract_status = 'ativo'
    AND c.payment_status = 'pago'
  LIMIT 1;

  IF _contract_id IS NOT NULL THEN
    RETURN _contract_id;
  END IF;

  _ends := public.prepaid_ends_on(_starts_on, _plan.duration_months);
  _months := public.prepaid_coverage_months(_starts_on, _plan.duration_months);

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
    _starts_on, _ends, _plan.duration_months, _plan.training_days_per_week,
    COALESCE(_plan.reference_monthly_price, _plan.monthly_price), _amount,
    _payment_method, _installments_final,
    'pago',
    CASE WHEN _plan.duration_months > 0 THEN 'ativo' ELSE 'expirado' END,
    now(), auth.uid(),
    now(), auth.uid(),
    COALESCE(_confirmation_meta, '{}'::jsonb)
  )
  RETURNING id INTO _contract_id;

  INSERT INTO public.contract_payments (
    contract_id, amount, payment_method, installments,
    machine_reference, action, notes, confirmed_by, confirmation_meta
  ) VALUES (
    _contract_id, _amount, _payment_method, _installments_final,
    _machine_reference, 'confirm', _notes, auth.uid(), COALESCE(_confirmation_meta, '{}'::jsonb)
  );

  IF _plan.duration_months > 0 THEN
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
    updated_at = now()
  WHERE id = _student_id;

  RETURN _contract_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_individual_prepaid_payment(UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_individual_prepaid_payment(UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_family_prepaid_payment(
  _family_group_id UUID,
  _plan_id UUID,
  _starts_on DATE,
  _payment_method TEXT,
  _installments INTEGER,
  _member_student_ids UUID[],
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
  _family public.family_groups%ROWTYPE;
  _plan public.plans%ROWTYPE;
  _contract_id UUID;
  _ends DATE;
  _months DATE[];
  _month DATE;
  _amount NUMERIC(10,2);
  _installments_final INTEGER;
  _sid UUID;
  _freq INTEGER;
BEGIN
  SELECT * INTO _family FROM public.family_groups WHERE id = _family_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo familiar não encontrado';
  END IF;

  IF NOT public.is_admin_only(_family.academy_id) THEN
    RAISE EXCEPTION 'Apenas administrador pode confirmar pagamento familiar';
  END IF;

  IF _member_student_ids IS NULL OR array_length(_member_student_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos um integrante coberto';
  END IF;

  SELECT * INTO _plan FROM public.plans WHERE id = _plan_id AND academy_id = _family.academy_id;
  IF NOT FOUND OR _plan.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Plano inválido ou inativo';
  END IF;

  IF _plan.billing_mode <> 'machine_prepaid' THEN
    RAISE EXCEPTION 'Contrato familiar exige plano machine_prepaid';
  END IF;

  IF _payment_method NOT IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida';
  END IF;

  _installments_final := COALESCE(_installments, 1);
  IF _payment_method <> 'cartao_credito' THEN
    _installments_final := 1;
  ELSIF _plan.allows_installments IS NOT TRUE THEN
    _installments_final := 1;
  ELSIF _installments_final < 1 OR _installments_final > COALESCE(_plan.max_installments, 1) THEN
    RAISE EXCEPTION 'Quantidade de parcelas inválida para este plano';
  END IF;

  _amount := COALESCE(_total_amount, _plan.package_total_amount, _plan.monthly_price);
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Valor total inválido';
  END IF;

  SELECT c.id INTO _contract_id
  FROM public.student_contracts c
  WHERE c.family_group_id = _family_group_id
    AND c.contract_status = 'ativo'
    AND c.payment_status = 'pago'
  LIMIT 1;

  IF _contract_id IS NOT NULL THEN
    RETURN _contract_id;
  END IF;

  _ends := public.prepaid_ends_on(_starts_on, _plan.duration_months);
  _months := public.prepaid_coverage_months(_starts_on, _plan.duration_months);

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
    _family.academy_id, NULL, _family_group_id, _plan.id,
    _starts_on, _ends, _plan.duration_months, _plan.training_days_per_week,
    COALESCE(_plan.reference_monthly_price, _plan.monthly_price), _amount,
    _payment_method, _installments_final,
    'pago', 'ativo',
    now(), auth.uid(),
    now(), auth.uid(),
    COALESCE(_confirmation_meta, '{}'::jsonb)
  )
  RETURNING id INTO _contract_id;

  INSERT INTO public.contract_payments (
    contract_id, amount, payment_method, installments,
    machine_reference, action, notes, confirmed_by, confirmation_meta
  ) VALUES (
    _contract_id, _amount, _payment_method, _installments_final,
    _machine_reference, 'confirm', _notes, auth.uid(), COALESCE(_confirmation_meta, '{}'::jsonb)
  );

  FOREACH _sid IN ARRAY _member_student_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = _sid AND s.academy_id = _family.academy_id
    ) THEN
      RAISE EXCEPTION 'Integrante inválido para a academia';
    END IF;

    SELECT COALESCE(p.training_days_per_week, _plan.training_days_per_week)
      INTO _freq
    FROM public.students s
    LEFT JOIN public.plans p ON p.id = s.plan_id
    WHERE s.id = _sid;

    INSERT INTO public.contract_members (
      contract_id, student_id, weekly_frequency, plan_id,
      coverage_starts_on, coverage_ends_on, status
    ) VALUES (
      _contract_id, _sid, _freq, _plan.id, _starts_on, _ends, 'ativo'
    )
    ON CONFLICT (contract_id, student_id) DO UPDATE
    SET status = 'ativo',
        coverage_starts_on = EXCLUDED.coverage_starts_on,
        coverage_ends_on = EXCLUDED.coverage_ends_on,
        updated_at = now();

    INSERT INTO public.family_members (family_group_id, student_id, relationship, status, joined_at)
    VALUES (_family_group_id, _sid, 'integrante', 'ativo', now())
    ON CONFLICT (family_group_id, student_id) DO UPDATE
    SET status = 'ativo', joined_at = COALESCE(public.family_members.joined_at, now()), left_at = NULL, updated_at = now();

    FOREACH _month IN ARRAY _months LOOP
      INSERT INTO public.student_contract_months (
        contract_id, student_id, academy_id, reference_month, status, source, paid_at
      ) VALUES (
        _contract_id, _sid, _family.academy_id, _month, 'pago', 'family', now()
      )
      ON CONFLICT (contract_id, student_id, reference_month) DO NOTHING;
    END LOOP;

    UPDATE public.students
    SET
      status = 'ativo',
      payment_review_status = 'confirmado',
      updated_at = now()
    WHERE id = _sid;
  END LOOP;

  UPDATE public.family_groups
  SET status = 'ativo', updated_at = now()
  WHERE id = _family_group_id;

  RETURN _contract_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_family_prepaid_payment(UUID, UUID, DATE, TEXT, INTEGER, UUID[], NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_family_prepaid_payment(UUID, UUID, DATE, TEXT, INTEGER, UUID[], NUMERIC, TEXT, TEXT, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_or_refund_prepaid_contract(
  _contract_id UUID,
  _action TEXT,
  _reason TEXT,
  _confirmation_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _contract public.student_contracts%ROWTYPE;
  _today_month DATE := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::timestamp)::date;
BEGIN
  IF _action NOT IN ('cancel', 'refund') THEN
    RAISE EXCEPTION 'Ação inválida';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo';
  END IF;

  SELECT * INTO _contract FROM public.student_contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  IF NOT public.is_admin_only(_contract.academy_id) THEN
    RAISE EXCEPTION 'Apenas administrador pode cancelar/estornar contrato';
  END IF;

  UPDATE public.student_contracts
  SET
    payment_status = CASE WHEN _action = 'refund' THEN 'estornado' ELSE 'cancelado' END,
    contract_status = 'cancelado',
    updated_at = now(),
    confirmation_meta = COALESCE(confirmation_meta, '{}'::jsonb) || COALESCE(_confirmation_meta, '{}'::jsonb)
  WHERE id = _contract_id;

  -- Preserve past paid months; revoke future months
  UPDATE public.student_contract_months
  SET status = CASE WHEN _action = 'refund' THEN 'estornado' ELSE 'cancelado' END
  WHERE contract_id = _contract_id
    AND reference_month > _today_month
    AND status = 'pago';

  UPDATE public.contract_members
  SET status = 'cancelado', updated_at = now()
  WHERE contract_id = _contract_id AND status = 'ativo';

  INSERT INTO public.contract_payments (
    contract_id, amount, payment_method, installments,
    action, notes, confirmed_by, confirmation_meta
  ) VALUES (
    _contract_id, _contract.total_amount, _contract.payment_method, _contract.installments,
    _action, _reason, auth.uid(), COALESCE(_confirmation_meta, '{}'::jsonb)
  );

  RETURN _contract_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_or_refund_prepaid_contract(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_or_refund_prepaid_contract(UUID, TEXT, TEXT, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expire_ended_prepaid_contracts(_as_of DATE DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count INTEGER;
BEGIN
  UPDATE public.student_contracts
  SET contract_status = 'expirado', updated_at = now()
  WHERE contract_status = 'ativo'
    AND payment_status = 'pago'
    AND ends_on < _as_of;

  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_ended_prepaid_contracts(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_ended_prepaid_contracts(DATE) TO service_role;
