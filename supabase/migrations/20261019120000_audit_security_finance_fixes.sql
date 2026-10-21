-- Audit corrections (LOCAL — do not apply until an authorized go-live).
-- Additive only. Does not edit historical migrations.
-- Does not delete student, billing, or message history.

-- 1) WhatsApp: clients cannot read OTP bodies or rows from other academies.
--    academy_id IS NULL is no longer visible to every authenticated user.
DROP POLICY IF EXISTS "wm_admin" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "wm_student" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "wm_student_select" ON public.whatsapp_messages;

CREATE POLICY "wm_admin_select"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    academy_id IS NOT NULL
    AND public.is_admin_only(academy_id)
    AND message_type IS DISTINCT FROM 'otp'
  );

CREATE POLICY "wm_student_select"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    student_id IS NOT NULL
    AND public.can_access_student(student_id)
    AND message_type IS DISTINCT FROM 'otp'
  );

REVOKE ALL ON TABLE public.whatsapp_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.whatsapp_messages FROM authenticated;
GRANT SELECT ON TABLE public.whatsapp_messages TO authenticated;

-- 2) OTP tables: service role only. No client policies.
ALTER TABLE public.otp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "otp_tokens_read" ON public.otp_tokens;
DROP POLICY IF EXISTS "otp_tokens_all" ON public.otp_tokens;
DROP POLICY IF EXISTS "otp_rate_all" ON public.otp_rate_limits;
REVOKE ALL ON TABLE public.otp_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.otp_rate_limits FROM anon, authenticated;

-- 3) Belt changes for the graduations widget (not "any student update").
CREATE TABLE IF NOT EXISTS public.student_belt_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  belt TEXT NOT NULL,
  degrees INTEGER NOT NULL DEFAULT 0,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.student_belt_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "belt_events_staff_select" ON public.student_belt_events;
CREATE POLICY "belt_events_staff_select"
  ON public.student_belt_events FOR SELECT TO authenticated
  USING (academy_id = public.get_my_academy_id());

REVOKE ALL ON TABLE public.student_belt_events FROM anon;
GRANT SELECT ON TABLE public.student_belt_events TO authenticated;

CREATE OR REPLACE FUNCTION public.log_student_belt_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.belt IS DISTINCT FROM OLD.belt OR NEW.degrees IS DISTINCT FROM OLD.degrees THEN
    INSERT INTO public.student_belt_events (academy_id, student_id, full_name, belt, degrees)
    VALUES (NEW.academy_id, NEW.id, NEW.full_name, NEW.belt, COALESCE(NEW.degrees, 0));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_student_belt_change ON public.students;
CREATE TRIGGER trg_log_student_belt_change
  AFTER UPDATE OF belt, degrees ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.log_student_belt_change();

CREATE OR REPLACE FUNCTION public.get_recent_belt_changes(_limit INTEGER DEFAULT 8)
RETURNS TABLE (
  full_name TEXT,
  belt TEXT,
  degrees INTEGER,
  changed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.full_name, e.belt, e.degrees, e.changed_at
  FROM public.student_belt_events e
  WHERE e.academy_id = public.get_my_academy_id()
  ORDER BY e.changed_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 20);
$$;

REVOKE ALL ON FUNCTION public.get_recent_belt_changes(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_belt_changes(INTEGER) TO authenticated;

-- 4) Expire prepaid contracts whose window has ended. Does not delete rows.
CREATE OR REPLACE FUNCTION public.expire_elapsed_student_contracts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count INTEGER;
BEGIN
  UPDATE public.student_contracts
  SET contract_status = 'expirado',
      updated_at = now()
  WHERE contract_status = 'ativo'
    AND ends_on < CURRENT_DATE;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_elapsed_student_contracts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_elapsed_student_contracts() TO service_role;

-- 5) Family payment confirmation must use the official package price
--    and the covered practitioner count. Client totals are rejected.
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
  _official NUMERIC(10,2);
  _installments_final INTEGER;
  _sid UUID;
  _freq INTEGER;
  _cadastral_ok BOOLEAN;
  _covered INTEGER;
  _member_count INTEGER;
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

  IF COALESCE(_plan.audience, '') <> 'familia' THEN
    RAISE EXCEPTION 'Confirmação familiar exige plano do catálogo familiar';
  END IF;

  IF _plan.billing_mode <> 'machine_prepaid' THEN
    RAISE EXCEPTION 'Contrato familiar exige plano machine_prepaid';
  END IF;

  _covered := CASE COALESCE(_plan.category, '')
    WHEN 'familia_1' THEN 1
    WHEN 'familia_2' THEN 2
    WHEN 'familia_3' THEN 3
    ELSE NULL
  END;
  _member_count := array_length(_member_student_ids, 1);
  IF _covered IS NULL OR _member_count <> _covered THEN
    RAISE EXCEPTION 'Quantidade de integrantes incompatível com o Plano Familiar';
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

  _official := COALESCE(_plan.package_total_amount, _plan.monthly_price);
  IF _official IS NULL OR _official <= 0 THEN
    RAISE EXCEPTION 'Plano familiar sem preço de pacote';
  END IF;
  IF _total_amount IS NOT NULL AND abs(_total_amount - _official) > 0.01 THEN
    RAISE EXCEPTION 'Valor divergente do pacote oficial. O preço não pode ser alterado pelo cliente.';
  END IF;
  _amount := _official;

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

-- 6) Drop any leftover permissive policies on OTP (defense in depth).
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('otp_tokens', 'otp_rate_limits')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );
  END LOOP;
END $$;

-- Re-assert OTP is unreachable from clients (service_role bypasses RLS).
REVOKE ALL ON TABLE public.otp_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.otp_rate_limits FROM PUBLIC, anon, authenticated;

-- WhatsApp: no client writes; Edge Functions use service_role.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.whatsapp_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.whatsapp_messages TO authenticated;

-- 7) Expire contracts daily when pg_cron is available (best-effort).
--    generate-monthly-billings also calls expire_elapsed_student_contracts().
DO $cron$
BEGIN
  PERFORM cron.unschedule('expire-elapsed-student-contracts');
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END
$cron$;

DO $cron$
BEGIN
  PERFORM cron.schedule(
    'expire-elapsed-student-contracts',
    '20 3 * * *',
    $job$SELECT public.expire_elapsed_student_contracts();$job$
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron unavailable; expire_elapsed_student_contracts not scheduled';
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron unavailable; expire_elapsed_student_contracts not scheduled';
  WHEN OTHERS THEN
    RAISE NOTICE 'expire_elapsed_student_contracts schedule skipped: %', SQLERRM;
END
$cron$;
