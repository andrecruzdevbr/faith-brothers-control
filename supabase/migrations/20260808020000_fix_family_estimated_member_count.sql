-- Hotfix: family_groups.estimated_member_count CHECK requires >= 1 (or NULL).
-- register_family_wizard_atomic briefly inserted 0 before updating count → failed.
-- Additive: recreate function with initial estimated_member_count = 1.

CREATE OR REPLACE FUNCTION public.register_family_wizard_atomic(
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
  _family_name TEXT DEFAULT NULL,
  _financial_responsible_email TEXT DEFAULT NULL,
  _responsible_weekly_frequency INTEGER DEFAULT NULL,
  _members JSONB DEFAULT '[]'::jsonb,
  _responsible_trains BOOLEAN DEFAULT TRUE,
  _degrees INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean_wa TEXT;
  _full_name_trimmed TEXT;
  _guardian_trimmed TEXT;
  _belt_val TEXT;
  _degrees_val INTEGER;
  _clean_tax TEXT;
  _family_on BOOLEAN := FALSE;
  _plan public.plans%ROWTYPE;
  _method TEXT;
  _installments_final INTEGER;
  _review_status TEXT := 'nao_aplicavel';
  _invite TEXT;
  _family_id UUID;
  _resp_student_id UUID := NULL;
  _member JSONB;
  _member_name TEXT;
  _member_birth DATE;
  _member_notes TEXT;
  _member_freq INTEGER;
  _member_belt TEXT;
  _member_degrees INTEGER;
  _member_rel TEXT;
  _member_guardian TEXT;
  _existing_id UUID;
  _new_student_id UUID;
  _member_ids UUID[] := ARRAY[]::UUID[];
  _member_count INTEGER := 0;
  _resp_freq INTEGER;
  _trains BOOLEAN := COALESCE(_responsible_trains, TRUE);
BEGIN
  IF _user_id IS NULL OR _academy_id IS NULL THEN
    RAISE EXCEPTION 'user_id e academy_id são obrigatórios' USING ERRCODE = 'P0001';
  END IF;

  _full_name_trimmed := left(btrim(COALESCE(_full_name, '')), 120);
  IF length(_full_name_trimmed) < 3 THEN
    RAISE EXCEPTION 'Informe o nome do responsável financeiro' USING ERRCODE = 'P0001';
  END IF;

  _clean_wa := regexp_replace(btrim(COALESCE(_whatsapp, '')), '[^0-9]', '', 'g');
  IF length(_clean_wa) <> 11 THEN
    RAISE EXCEPTION 'WhatsApp do responsável inválido' USING ERRCODE = 'P0001';
  END IF;

  _guardian_trimmed := NULLIF(left(btrim(COALESCE(_guardian_name, '')), 120), '');
  _clean_tax := NULLIF(regexp_replace(btrim(COALESCE(_tax_id, '')), '[^0-9]', '', 'g'), '');
  IF _clean_tax IS NULL OR length(_clean_tax) NOT IN (11, 14) THEN
    RAISE EXCEPTION 'CPF/CNPJ de cobrança obrigatório para o plano familiar' USING ERRCODE = 'P0001';
  END IF;

  IF _birth_date IS NULL THEN
    RAISE EXCEPTION 'Data de nascimento do responsável é obrigatória' USING ERRCODE = 'P0001';
  END IF;

  IF _plan_id IS NULL THEN
    RAISE EXCEPTION 'Plano familiar obrigatório' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(s.family_plans_enabled, FALSE)
    INTO _family_on
  FROM public.academy_billing_settings s
  WHERE s.academy_id = _academy_id;

  IF NOT COALESCE(_family_on, FALSE) THEN
    RAISE EXCEPTION 'Planos familiares não estão habilitados nesta academia' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _plan
  FROM public.plans
  WHERE id = _plan_id
    AND academy_id = _academy_id
    AND active = TRUE;

  IF _plan.id IS NULL THEN
    RAISE EXCEPTION 'Plano inválido ou inativo' USING ERRCODE = 'P0001';
  END IF;

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

  IF EXISTS (
    SELECT 1 FROM public.student_billing_profiles sbp WHERE sbp.tax_id = _clean_tax
  ) OR EXISTS (
    SELECT 1 FROM public.family_groups fg
    WHERE fg.financial_responsible_tax_id = _clean_tax
      AND fg.status IN ('pendente', 'ativo')
  ) THEN
    RAISE EXCEPTION 'Este CPF/CNPJ já está cadastrado.' USING ERRCODE = '23505';
  END IF;

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
    COALESCE(
      NULLIF(left(btrim(COALESCE(_family_name, '')), 120), ''),
      'Família ' || _full_name_trimmed
    ),
    _invite,
    _full_name_trimmed,
    _clean_tax,
    _clean_wa,
    NULLIF(left(btrim(COALESCE(_financial_responsible_email, '')), 160), ''),
    1,
    'pendente'
  )
  RETURNING id INTO _family_id;

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

  IF _trains THEN
    _belt_val := COALESCE(NULLIF(btrim(COALESCE(_belt, '')), ''), 'Branca');
    _degrees_val := COALESCE(_degrees, 0);
    IF _degrees_val < 0 OR _degrees_val > 4 THEN
      RAISE EXCEPTION 'Quantidade de graus do responsável inválida (0 a 4)' USING ERRCODE = 'P0001';
    END IF;
    _resp_freq := COALESCE(
      NULLIF(_responsible_weekly_frequency, 0),
      _plan.training_days_per_week,
      3
    );
    IF _resp_freq < 1 OR _resp_freq > 7 THEN
      _resp_freq := COALESCE(_plan.training_days_per_week, 3);
    END IF;

    INSERT INTO public.students (
      academy_id, profile_user_id, full_name, whatsapp, email, belt, degrees, status, plan_id,
      birth_date, guardian_name, requested_payment_method, requested_installments,
      payment_review_status, pending_family_group_id, pending_family_invite_code
    ) VALUES (
      _academy_id, _user_id, _full_name_trimmed, _clean_wa,
      NULLIF(left(btrim(COALESCE(_financial_responsible_email, '')), 160), ''),
      _belt_val, _degrees_val, 'pendente_aprovacao'::public.student_status, _plan_id,
      _birth_date, _guardian_trimmed, _method, _installments_final, _review_status, _family_id, _invite
    )
    ON CONFLICT (profile_user_id) DO UPDATE
      SET academy_id = EXCLUDED.academy_id,
          full_name = EXCLUDED.full_name,
          whatsapp = EXCLUDED.whatsapp,
          email = EXCLUDED.email,
          belt = EXCLUDED.belt,
          degrees = EXCLUDED.degrees,
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

    SELECT s.id INTO _resp_student_id
    FROM public.students s
    WHERE s.profile_user_id = _user_id
    LIMIT 1;

    IF _resp_student_id IS NULL THEN
      RAISE EXCEPTION 'Não foi possível criar o aluno do responsável' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.student_billing_profiles (student_id, tax_id)
    VALUES (_resp_student_id, _clean_tax)
    ON CONFLICT (student_id) DO UPDATE
      SET tax_id = EXCLUDED.tax_id, updated_at = now();

    UPDATE public.family_groups
    SET financial_responsible_student_id = _resp_student_id, updated_at = now()
    WHERE id = _family_id;

    INSERT INTO public.family_members (
      family_group_id, student_id, relationship, status, joined_at,
      requested_weekly_frequency, notes
    ) VALUES (
      _family_id, _resp_student_id, 'responsável', 'pendente', NULL, _resp_freq, NULL
    )
    ON CONFLICT (family_group_id, student_id) DO UPDATE
      SET relationship = 'responsável',
          status = 'pendente',
          requested_weekly_frequency = EXCLUDED.requested_weekly_frequency,
          updated_at = now();

    _member_ids := array_append(_member_ids, _resp_student_id);
    _member_count := 1;
  END IF;

  IF _members IS NULL OR jsonb_typeof(_members) <> 'array' OR jsonb_array_length(_members) < 1 THEN
    RAISE EXCEPTION 'Inclua ao menos um integrante além do responsável financeiro'
      USING ERRCODE = 'P0001';
  END IF;

  FOR _member IN SELECT * FROM jsonb_array_elements(_members)
  LOOP
    _existing_id := NULLIF((_member->>'existing_student_id')::text, '')::uuid;
    _member_name := left(btrim(COALESCE(_member->>'full_name', '')), 120);
    _member_notes := NULLIF(left(btrim(COALESCE(_member->>'notes', '')), 500), '');
    _member_rel := COALESCE(NULLIF(left(btrim(COALESCE(_member->>'relationship', '')), 40), ''), 'integrante');
    _member_guardian := NULLIF(left(btrim(COALESCE(_member->>'guardian_name', '')), 120), '');
    _member_freq := NULLIF((_member->>'training_days')::text, '')::integer;
    IF _member_freq IS NULL OR _member_freq < 1 OR _member_freq > 7 THEN
      _member_freq := COALESCE(_plan.training_days_per_week, 3);
    END IF;
    _member_belt := COALESCE(NULLIF(btrim(COALESCE(_member->>'belt', '')), ''), 'Branca');
    BEGIN
      _member_degrees := COALESCE(NULLIF((_member->>'degrees')::text, '')::integer, 0);
    EXCEPTION WHEN OTHERS THEN
      _member_degrees := 0;
    END;
    IF _member_degrees < 0 OR _member_degrees > 4 THEN
      RAISE EXCEPTION 'Quantidade de graus do integrante inválida (0 a 4)' USING ERRCODE = 'P0001';
    END IF;

    IF (_member->>'birth_date') IS NOT NULL AND btrim(_member->>'birth_date') <> '' THEN
      _member_birth := (_member->>'birth_date')::date;
    ELSE
      _member_birth := NULL;
    END IF;

    IF _existing_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = _existing_id AND s.academy_id = _academy_id
      ) THEN
        RAISE EXCEPTION 'Aluno existente inválido para vínculo familiar' USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.family_members fm
        WHERE fm.student_id = _existing_id AND fm.status = 'ativo'
      ) THEN
        RAISE EXCEPTION 'Aluno já vinculado a outra família ativa' USING ERRCODE = 'P0001';
      END IF;
      IF _existing_id = ANY (_member_ids) THEN
        CONTINUE;
      END IF;

      UPDATE public.students
      SET
        plan_id = _plan_id,
        pending_family_group_id = _family_id,
        payment_review_status = CASE
          WHEN _review_status = 'aguardando_conferencia' THEN 'aguardando_conferencia'
          ELSE payment_review_status
        END,
        requested_payment_method = COALESCE(_method, requested_payment_method),
        requested_installments = COALESCE(_installments_final, requested_installments),
        updated_at = now()
      WHERE id = _existing_id;

      INSERT INTO public.family_members (
        family_group_id, student_id, relationship, status, joined_at,
        requested_weekly_frequency, notes
      ) VALUES (
        _family_id, _existing_id, _member_rel, 'pendente', NULL, _member_freq, _member_notes
      )
      ON CONFLICT (family_group_id, student_id) DO UPDATE
        SET status = 'pendente',
            relationship = EXCLUDED.relationship,
            requested_weekly_frequency = EXCLUDED.requested_weekly_frequency,
            notes = EXCLUDED.notes,
            updated_at = now();

      _member_ids := array_append(_member_ids, _existing_id);
      _member_count := _member_count + 1;
      CONTINUE;
    END IF;

    IF length(COALESCE(_member_name, '')) < 3 THEN
      RAISE EXCEPTION 'Informe o nome de cada integrante' USING ERRCODE = 'P0001';
    END IF;
    IF _member_birth IS NULL THEN
      RAISE EXCEPTION 'Informe a data de nascimento de cada integrante' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.students (
      academy_id, profile_user_id, full_name, whatsapp, email, belt, degrees, status, plan_id,
      birth_date, guardian_name, requested_payment_method, requested_installments,
      payment_review_status, pending_family_group_id
    ) VALUES (
      _academy_id, NULL, _member_name, '', NULL, _member_belt, _member_degrees,
      'pendente_aprovacao'::public.student_status, _plan_id, _member_birth, _member_guardian,
      _method, _installments_final, _review_status, _family_id
    )
    RETURNING id INTO _new_student_id;

    INSERT INTO public.family_members (
      family_group_id, student_id, relationship, status, joined_at,
      requested_weekly_frequency, notes
    ) VALUES (
      _family_id, _new_student_id, _member_rel, 'pendente', NULL, _member_freq, _member_notes
    );

    _member_ids := array_append(_member_ids, _new_student_id);
    _member_count := _member_count + 1;
  END LOOP;

  IF _member_count < 1 THEN
    RAISE EXCEPTION 'Inclua ao menos um praticante na família' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.family_groups
  SET estimated_member_count = _member_count, updated_at = now()
  WHERE id = _family_id;

  RETURN jsonb_build_object(
    'family_group_id', _family_id,
    'responsible_student_id', _resp_student_id,
    'responsible_trains', _trains,
    'invite_code', _invite,
    'member_student_ids', to_jsonb(_member_ids),
    'member_count', _member_count
  );
END;
$$;
