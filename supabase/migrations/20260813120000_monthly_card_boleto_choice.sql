-- ================================================================
-- Monthly boleto XOR card (veteran + cron skip for machine methods).
-- Additive only. Does NOT edit applied migrations.
-- ================================================================

-- 1) Asaas cron: never bill students who chose machine/card payment
CREATE OR REPLACE FUNCTION public.prepaid_cron_skip_reason(
  _student_id UUID,
  _reference_month DATE
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = _student_id
        AND COALESCE(s.payment_review_status, '') = 'aguardando_conferencia'
    ) THEN 'skipped_awaiting_machine_payment'
    WHEN EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = _student_id
        AND COALESCE(s.requested_payment_method, '') IN (
          'cartao_credito', 'cartao_debito', 'pix', 'dinheiro'
        )
    ) THEN 'skipped_machine_payment_method'
    WHEN EXISTS (
      SELECT 1
      FROM public.student_contract_months m
      WHERE m.student_id = _student_id
        AND m.reference_month = date_trunc('month', _reference_month::timestamp)::date
        AND m.status = 'pago'
        AND m.source = 'family'
    ) THEN 'skipped_family_contract_covered'
    WHEN EXISTS (
      SELECT 1
      FROM public.student_contract_months m
      WHERE m.student_id = _student_id
        AND m.reference_month = date_trunc('month', _reference_month::timestamp)::date
        AND m.status = 'pago'
    ) THEN 'skipped_prepaid_month_covered'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.prepaid_cron_skip_reason(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepaid_cron_skip_reason(UUID, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.prepaid_cron_skip_reason(UUID, DATE) IS
  'Skip Asaas generation when coverage exists, payment awaits machine confirm, or student chose card/machine (never boleto).';

-- 2) Veteran mensal: ADM chooses boleto OR cartão (same as new_student mensal)
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

    _method := NULLIF(btrim(COALESCE(_payment_method, '')), '');
    IF _method IS NULL OR _method NOT IN ('boleto', 'cartao_credito') THEN
      RAISE EXCEPTION 'Informe a forma de pagamento do mensal (boleto ou cartão).'
        USING ERRCODE = 'P0001';
    END IF;

    IF _method = 'boleto' THEN
      UPDATE public.students
      SET
        plan_id = _plan.id,
        requested_billing_period = 'mensal',
        billing_period_status = 'escolhido',
        requested_payment_method = 'boleto',
        requested_installments = NULL,
        payment_review_status = 'nao_aplicavel',
        status = 'ativo',
        updated_at = now()
      WHERE id = _student_id;

      RETURN _plan.id;
    END IF;

    -- Mensal cartão/maquininha: never auto-paid, never Asaas boleto
    _installments_final := GREATEST(
      1,
      LEAST(COALESCE(_installments, 1), COALESCE(_plan.max_installments, 12))
    );

    UPDATE public.students
    SET
      plan_id = _plan.id,
      requested_billing_period = 'mensal',
      billing_period_status = 'escolhido',
      requested_payment_method = 'cartao_credito',
      requested_installments = _installments_final,
      payment_review_status = 'aguardando_conferencia',
      -- keep cadastral status; confirm_individual_prepaid_payment activates after ADM confirm
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
  'ADM defines veteran plan after approval. Mensal: boleto (Asaas) XOR cartão (await confirm). T/S/A: machine prepaid by modality.';
