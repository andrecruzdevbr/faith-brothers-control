-- Separate cadastral approval from financial confirmation.
-- Additive: approved_at / approved_by on students; prepaid stays unpaid until ADM payment confirm.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN public.students.approved_at IS
  'Cadastral approval timestamp (ADM). Distinct from contract payment_confirmed_at.';
COMMENT ON COLUMN public.students.approved_by IS
  'ADM user who approved the registration (cadastral), not the payment.';

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
  _review TEXT;
  _audience TEXT;
  _already_approved_at TIMESTAMPTZ;
  _family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    s.academy_id,
    s.status,
    s.payment_review_status,
    s.registration_audience,
    s.approved_at,
    s.pending_family_group_id
  INTO
    _academy_id,
    _current_status,
    _review,
    _audience,
    _already_approved_at,
    _family_id
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

  -- Idempotent cadastral re-click (prepaid / veteran still pending financially)
  IF _approve IS TRUE AND _already_approved_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF _approve IS TRUE AND NOT public.is_admin_only(_academy_id) THEN
    IF COALESCE(_review, 'nao_aplicavel') <> 'nao_aplicavel' THEN
      RAISE EXCEPTION 'Somente administrador pode processar cadastro com pagamento antecipado'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF _approve IS NOT TRUE THEN
    UPDATE public.students
    SET
      status = 'rejeitado'::public.student_status,
      payment_review_status = CASE
        WHEN COALESCE(payment_review_status, 'nao_aplicavel') = 'aguardando_conferencia' THEN 'recusado'
        ELSE payment_review_status
      END,
      updated_at = now()
    WHERE id = _student_id
      AND status = 'pendente_aprovacao'::public.student_status;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  -- Veteran: cadastral only → wait for commercial modality (no financial activation)
  IF COALESCE(_audience, '') = 'veterano' THEN
    UPDATE public.students
    SET
      billing_period_status = 'aguardando_escolha',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_at = now()
    WHERE id = _student_id
      AND status = 'pendente_aprovacao'::public.student_status;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno' USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  -- Prepaid / machine: cadastral only — stay pending + unpaid until “Pagamento aprovado”
  IF COALESCE(_review, 'nao_aplicavel') = 'aguardando_conferencia' THEN
    UPDATE public.students
    SET
      approved_at = now(),
      approved_by = auth.uid(),
      updated_at = now()
    WHERE id = _student_id
      AND status = 'pendente_aprovacao'::public.student_status;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno' USING ERRCODE = 'P0001';
    END IF;

    -- Family unit: mark all pending members of the same pending family group
    IF _family_id IS NOT NULL THEN
      UPDATE public.students
      SET
        approved_at = COALESCE(approved_at, now()),
        approved_by = COALESCE(approved_by, auth.uid()),
        updated_at = now()
      WHERE pending_family_group_id = _family_id
        AND status = 'pendente_aprovacao'::public.student_status
        AND approved_at IS NULL;
    END IF;

    RETURN;
  END IF;

  -- Monthly / Asaas (or other non-machine pending): cadastral approve activates + billing cron continues
  UPDATE public.students
  SET
    status = 'ativo'::public.student_status,
    approved_at = now(),
    approved_by = auth.uid(),
    updated_at = now()
  WHERE id = _student_id
    AND status = 'pendente_aprovacao'::public.student_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_student(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_student(UUID, BOOLEAN) TO authenticated, service_role;

-- Require cadastral approval before releasing prepaid months (individual)
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
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_individual_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB
) TO authenticated, service_role;

-- Family: require cadastral approval on responsible (or any pending member already approved)
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
  _cadastral_ok BOOLEAN;
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

  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.academy_id = _family.academy_id
      AND s.approved_at IS NOT NULL
      AND (
        s.id = _family.financial_responsible_student_id
        OR s.pending_family_group_id = _family_group_id
        OR s.id = ANY (_member_student_ids)
      )
  ) INTO _cadastral_ok;

  IF NOT COALESCE(_cadastral_ok, FALSE) THEN
    RAISE EXCEPTION 'Aprove o cadastro da família antes de confirmar o pagamento'
      USING ERRCODE = 'P0001';
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

    SELECT COALESCE(
      fm.requested_weekly_frequency,
      p.training_days_per_week,
      _plan.training_days_per_week
    )
      INTO _freq
    FROM public.students s
    LEFT JOIN public.plans p ON p.id = s.plan_id
    LEFT JOIN public.family_members fm
      ON fm.student_id = s.id AND fm.family_group_id = _family_group_id
    WHERE s.id = _sid
    LIMIT 1;

    INSERT INTO public.contract_members (
      contract_id, student_id, weekly_frequency, plan_id,
      coverage_starts_on, coverage_ends_on, status
    ) VALUES (
      _contract_id, _sid, _freq, _plan.id, _starts_on, _ends, 'ativo'
    )
    ON CONFLICT (contract_id, student_id) DO UPDATE
    SET status = 'ativo',
        weekly_frequency = EXCLUDED.weekly_frequency,
        coverage_starts_on = EXCLUDED.coverage_starts_on,
        coverage_ends_on = EXCLUDED.coverage_ends_on,
        updated_at = now();

    INSERT INTO public.family_members (family_group_id, student_id, relationship, status, joined_at)
    VALUES (_family_group_id, _sid, 'integrante', 'ativo', now())
    ON CONFLICT (family_group_id, student_id) DO UPDATE
    SET status = 'ativo',
        joined_at = COALESCE(public.family_members.joined_at, now()),
        left_at = NULL,
        updated_at = now();

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
      pending_family_group_id = NULL,
      approved_at = COALESCE(approved_at, now()),
      approved_by = COALESCE(approved_by, auth.uid()),
      updated_at = now()
    WHERE id = _sid;
  END LOOP;

  UPDATE public.family_groups
  SET status = 'ativo', updated_at = now()
  WHERE id = _family_group_id;

  RETURN _contract_id;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_family_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, UUID[], NUMERIC, TEXT, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_family_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, UUID[], NUMERIC, TEXT, TEXT, JSONB
) TO authenticated, service_role;
