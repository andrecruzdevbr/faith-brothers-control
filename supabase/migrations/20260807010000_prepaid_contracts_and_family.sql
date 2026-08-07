-- ================================================================
-- FAITH BROTHERS — Prepaid contracts + family groups (Phase 2 schema)
-- Additive only. Does NOT enable flags in production academies.
-- Does NOT push automatically — apply only after review.
-- ================================================================

-- ---------------------------------------------------------------------------
-- 1) Feature flags on academy_billing_settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.academy_billing_settings
  ADD COLUMN IF NOT EXISTS prepaid_contracts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS family_plans_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.academy_billing_settings.prepaid_contracts_enabled IS
  'Quando true, permite cadastro/aprovação de pacotes antecipados (machine). Default false.';
COMMENT ON COLUMN public.academy_billing_settings.family_plans_enabled IS
  'Quando true, permite grupos/contratos familiares. Default false.';

-- ---------------------------------------------------------------------------
-- 2) Extend plans catalog
-- ---------------------------------------------------------------------------
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS plan_kind TEXT NOT NULL DEFAULT 'mensal',
  ADD COLUMN IF NOT EXISTS duration_months INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reference_monthly_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS package_total_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'asaas_monthly',
  ADD COLUMN IF NOT EXISTS allows_installments BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_installments INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_audience_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_audience_check
  CHECK (audience IN ('normal', 'veterano', 'familia', 'outro'));

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_plan_kind_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_plan_kind_check
  CHECK (plan_kind IN ('mensal', 'trimestral', 'semestral', 'anual', 'avulso'));

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_billing_mode_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_billing_mode_check
  CHECK (billing_mode IN ('asaas_monthly', 'machine_prepaid', 'machine_dropin'));

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_duration_months_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_duration_months_check
  CHECK (duration_months >= 0 AND duration_months <= 36);

ALTER TABLE public.plans
  DROP CONSTRAINT IF EXISTS plans_max_installments_check;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_max_installments_check
  CHECK (max_installments >= 1 AND max_installments <= 24);

-- Backfill legacy monthly plans
UPDATE public.plans
SET
  audience = COALESCE(NULLIF(audience, ''), 'normal'),
  plan_kind = COALESCE(NULLIF(plan_kind, ''), 'mensal'),
  duration_months = COALESCE(duration_months, 1),
  reference_monthly_price = COALESCE(reference_monthly_price, monthly_price),
  billing_mode = COALESCE(NULLIF(billing_mode, ''), 'asaas_monthly'),
  allows_installments = COALESCE(allows_installments, FALSE),
  max_installments = COALESCE(max_installments, 1),
  updated_at = now()
WHERE TRUE;

-- Seed veteran prepaid packages (does not touch existing 210/230/250 plans)
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
  v.billing_mode,
  v.allows_installments,
  v.max_installments,
  v.description
FROM public.academies a
CROSS JOIN (
  VALUES
    (
      'Pacote Semestral Veterano 5 dias'::text,
      5,
      180.00::numeric,
      1080.00::numeric,
      6,
      'semestral'::text,
      'machine_prepaid'::text,
      TRUE,
      6,
      'Pacote antecipado de 6 meses. Parcelas do cartão são apenas informação da maquininha.'::text
    ),
    (
      'Pacote Semestral Veterano 3 dias',
      3,
      150.00,
      900.00,
      6,
      'semestral',
      'machine_prepaid',
      TRUE,
      6,
      'Pacote antecipado de 6 meses. Parcelas do cartão são apenas informação da maquininha.'
    ),
    (
      'Pacote Semestral Veterano 2 dias',
      2,
      120.00,
      720.00,
      6,
      'semestral',
      'machine_prepaid',
      TRUE,
      6,
      'Pacote antecipado de 6 meses. Parcelas do cartão são apenas informação da maquininha.'
    ),
    (
      'Treino avulso veterano',
      1,
      45.00,
      45.00,
      0,
      'avulso',
      'machine_dropin',
      FALSE,
      1,
      'Pagamento avulso na maquininha. Não cria meses futuros nem entra no cron Asaas.'
    )
) AS v(
  name, days, reference_monthly_price, package_total_amount, duration_months,
  plan_kind, billing_mode, allows_installments, max_installments, description
)
ON CONFLICT (academy_id, name) DO UPDATE
SET
  monthly_price = EXCLUDED.monthly_price,
  training_days_per_week = EXCLUDED.training_days_per_week,
  active = TRUE,
  category = EXCLUDED.category,
  audience = EXCLUDED.audience,
  plan_kind = EXCLUDED.plan_kind,
  duration_months = EXCLUDED.duration_months,
  reference_monthly_price = EXCLUDED.reference_monthly_price,
  package_total_amount = EXCLUDED.package_total_amount,
  billing_mode = EXCLUDED.billing_mode,
  allows_installments = EXCLUDED.allows_installments,
  max_installments = EXCLUDED.max_installments,
  description = EXCLUDED.description,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) Student registration commercial intent (public signup)
-- ---------------------------------------------------------------------------
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS requested_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS requested_installments INTEGER,
  ADD COLUMN IF NOT EXISTS payment_review_status TEXT NOT NULL DEFAULT 'nao_aplicavel',
  ADD COLUMN IF NOT EXISTS pending_family_group_id UUID,
  ADD COLUMN IF NOT EXISTS pending_family_invite_code TEXT;

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_payment_review_status_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_payment_review_status_check
  CHECK (payment_review_status IN (
    'nao_aplicavel', 'aguardando_conferencia', 'confirmado', 'recusado'
  ));

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_requested_payment_method_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_requested_payment_method_check
  CHECK (
    requested_payment_method IS NULL
    OR requested_payment_method IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro')
  );

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_requested_installments_check;
ALTER TABLE public.students
  ADD CONSTRAINT students_requested_installments_check
  CHECK (
    requested_installments IS NULL
    OR (requested_installments >= 1 AND requested_installments <= 24)
  );

-- ---------------------------------------------------------------------------
-- 4) Family groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.family_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  financial_responsible_name TEXT NOT NULL,
  financial_responsible_tax_id TEXT,
  financial_responsible_phone TEXT,
  financial_responsible_email TEXT,
  financial_responsible_student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  estimated_member_count INTEGER CHECK (estimated_member_count IS NULL OR estimated_member_count >= 1),
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academy_id, invite_code)
);

CREATE INDEX IF NOT EXISTS idx_family_groups_academy ON public.family_groups(academy_id);
CREATE INDEX IF NOT EXISTS idx_family_groups_status ON public.family_groups(academy_id, status);

CREATE TABLE IF NOT EXISTS public.family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_group_id UUID NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'integrante',
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'ativo', 'removido')),
  joined_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_group_id, student_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_one_active_group
  ON public.family_members (student_id)
  WHERE status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_family_members_group ON public.family_members(family_group_id);
CREATE INDEX IF NOT EXISTS idx_family_members_student ON public.family_members(student_id);

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_pending_family_group_id_fkey;
ALTER TABLE public.students
  ADD CONSTRAINT students_pending_family_group_id_fkey
  FOREIGN KEY (pending_family_group_id) REFERENCES public.family_groups(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5) Contracts (individual XOR family)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  family_group_id UUID REFERENCES public.family_groups(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  duration_months INTEGER NOT NULL CHECK (duration_months >= 0 AND duration_months <= 36),
  weekly_frequency INTEGER,
  reference_monthly_amount NUMERIC(10,2),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro')),
  installments INTEGER NOT NULL DEFAULT 1 CHECK (installments >= 1 AND installments <= 24),
  payment_status TEXT NOT NULL DEFAULT 'aguardando'
    CHECK (payment_status IN ('aguardando', 'pago', 'cancelado', 'estornado')),
  contract_status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (contract_status IN ('rascunho', 'ativo', 'expirado', 'cancelado')),
  registration_notes TEXT,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_confirmed_at TIMESTAMPTZ,
  payment_confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmation_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_contracts_party_xor CHECK (
    (student_id IS NOT NULL AND family_group_id IS NULL)
    OR (student_id IS NULL AND family_group_id IS NOT NULL)
  ),
  CONSTRAINT student_contracts_ends_on_check CHECK (ends_on >= starts_on),
  CONSTRAINT student_contracts_credit_installments_check CHECK (
    payment_method = 'cartao_credito'
    OR installments = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_student_contracts_academy ON public.student_contracts(academy_id);
CREATE INDEX IF NOT EXISTS idx_student_contracts_student ON public.student_contracts(student_id);
CREATE INDEX IF NOT EXISTS idx_student_contracts_family ON public.student_contracts(family_group_id);
CREATE INDEX IF NOT EXISTS idx_student_contracts_status
  ON public.student_contracts(academy_id, contract_status, payment_status);

-- One active paid individual contract per student
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_one_active_paid_individual_contract
  ON public.student_contracts (student_id)
  WHERE student_id IS NOT NULL
    AND contract_status = 'ativo'
    AND payment_status = 'pago';

-- One active paid family contract per family group
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_one_active_paid_contract
  ON public.student_contracts (family_group_id)
  WHERE family_group_id IS NOT NULL
    AND contract_status = 'ativo'
    AND payment_status = 'pago';

CREATE TABLE IF NOT EXISTS public.contract_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.student_contracts(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  weekly_frequency INTEGER,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  coverage_starts_on DATE NOT NULL,
  coverage_ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'removido', 'cancelado')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, student_id),
  CONSTRAINT contract_members_coverage_check CHECK (coverage_ends_on >= coverage_starts_on)
);

CREATE INDEX IF NOT EXISTS idx_contract_members_student ON public.contract_members(student_id);
CREATE INDEX IF NOT EXISTS idx_contract_members_contract ON public.contract_members(contract_id);

CREATE TABLE IF NOT EXISTS public.student_contract_months (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.student_contracts(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pago'
    CHECK (status IN ('pago', 'pendente', 'cancelado', 'estornado', 'vencido')),
  source TEXT NOT NULL DEFAULT 'individual'
    CHECK (source IN ('individual', 'family')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, student_id, reference_month),
  CONSTRAINT student_contract_months_ref_day1 CHECK (EXTRACT(DAY FROM reference_month) = 1)
);

CREATE INDEX IF NOT EXISTS idx_contract_months_student_month_status
  ON public.student_contract_months (student_id, reference_month, status);

CREATE TABLE IF NOT EXISTS public.contract_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.student_contracts(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('cartao_credito', 'cartao_debito', 'pix', 'dinheiro')),
  installments INTEGER NOT NULL DEFAULT 1 CHECK (installments >= 1 AND installments <= 24),
  machine_reference TEXT,
  action TEXT NOT NULL
    CHECK (action IN ('confirm', 'cancel', 'refund')),
  notes TEXT,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmation_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_payments_one_confirm
  ON public.contract_payments (contract_id)
  WHERE action = 'confirm';

CREATE INDEX IF NOT EXISTS idx_contract_payments_contract ON public.contract_payments(contract_id);

-- ---------------------------------------------------------------------------
-- 6) Domain helpers (pure SQL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepaid_first_reference_month(_starts_on DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT date_trunc('month', _starts_on::timestamp)::date;
$$;

CREATE OR REPLACE FUNCTION public.prepaid_coverage_months(_starts_on DATE, _duration_months INTEGER)
RETURNS DATE[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  months DATE[] := ARRAY[]::DATE[];
  first_month DATE;
  i INTEGER;
BEGIN
  IF _duration_months IS NULL OR _duration_months <= 0 THEN
    RETURN months;
  END IF;
  first_month := public.prepaid_first_reference_month(_starts_on);
  FOR i IN 0..(_duration_months - 1) LOOP
    months := array_append(months, (first_month + (i || ' months')::interval)::date);
  END LOOP;
  RETURN months;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepaid_ends_on(_starts_on DATE, _duration_months INTEGER)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _duration_months IS NULL OR _duration_months <= 0 THEN _starts_on
    ELSE (
      (public.prepaid_first_reference_month(_starts_on) + ((_duration_months || ' months')::interval))::date
      - 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.student_has_prepaid_month_coverage(
  _student_id UUID,
  _reference_month DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_contract_months m
    WHERE m.student_id = _student_id
      AND m.reference_month = date_trunc('month', _reference_month::timestamp)::date
      AND m.status = 'pago'
  );
$$;

REVOKE ALL ON FUNCTION public.student_has_prepaid_month_coverage(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_has_prepaid_month_coverage(UUID, DATE) TO authenticated, service_role;

-- Returns cron skip reason when student must not receive Asaas for the month.
-- Prefers family reason when coverage source is family.
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

REVOKE ALL ON FUNCTION public.prepaid_cron_skip_reason(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepaid_cron_skip_reason(UUID, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_family_invite_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  code TEXT;
BEGIN
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  RETURN code;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_contract_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_payments ENABLE ROW LEVEL SECURITY;

-- family_groups
DROP POLICY IF EXISTS family_groups_select ON public.family_groups;
CREATE POLICY family_groups_select ON public.family_groups
  FOR SELECT TO authenticated
  USING (
    public.is_admin_of_academy(academy_id)
    OR EXISTS (
      SELECT 1
      FROM public.family_members fm
      JOIN public.students s ON s.id = fm.student_id
      WHERE fm.family_group_id = family_groups.id
        AND s.profile_user_id = auth.uid()
        AND fm.status IN ('pendente', 'ativo')
    )
  );

DROP POLICY IF EXISTS family_groups_admin_all ON public.family_groups;
CREATE POLICY family_groups_admin_all ON public.family_groups
  FOR ALL TO authenticated
  USING (public.is_admin_only(academy_id))
  WITH CHECK (public.is_admin_only(academy_id));

-- family_members
DROP POLICY IF EXISTS family_members_select ON public.family_members;
CREATE POLICY family_members_select ON public.family_members
  FOR SELECT TO authenticated
  USING (
    public.can_access_student(student_id)
    OR EXISTS (
      SELECT 1 FROM public.family_groups g
      WHERE g.id = family_members.family_group_id
        AND public.is_admin_of_academy(g.academy_id)
    )
  );

DROP POLICY IF EXISTS family_members_admin_all ON public.family_members;
CREATE POLICY family_members_admin_all ON public.family_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.family_groups g
      WHERE g.id = family_members.family_group_id
        AND public.is_admin_only(g.academy_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.family_groups g
      WHERE g.id = family_members.family_group_id
        AND public.is_admin_only(g.academy_id)
    )
  );

-- student_contracts
DROP POLICY IF EXISTS student_contracts_select ON public.student_contracts;
CREATE POLICY student_contracts_select ON public.student_contracts
  FOR SELECT TO authenticated
  USING (
    public.is_admin_of_academy(academy_id)
    OR (student_id IS NOT NULL AND public.can_access_student(student_id))
    OR (
      family_group_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.family_members fm
        JOIN public.students s ON s.id = fm.student_id
        WHERE fm.family_group_id = student_contracts.family_group_id
          AND s.profile_user_id = auth.uid()
          AND fm.status IN ('pendente', 'ativo')
      )
    )
  );

DROP POLICY IF EXISTS student_contracts_admin_all ON public.student_contracts;
CREATE POLICY student_contracts_admin_all ON public.student_contracts
  FOR ALL TO authenticated
  USING (public.is_admin_only(academy_id))
  WITH CHECK (public.is_admin_only(academy_id));

-- contract_members
DROP POLICY IF EXISTS contract_members_select ON public.contract_members;
CREATE POLICY contract_members_select ON public.contract_members
  FOR SELECT TO authenticated
  USING (
    public.can_access_student(student_id)
    OR EXISTS (
      SELECT 1 FROM public.student_contracts c
      WHERE c.id = contract_members.contract_id
        AND public.is_admin_of_academy(c.academy_id)
    )
  );

DROP POLICY IF EXISTS contract_members_admin_all ON public.contract_members;
CREATE POLICY contract_members_admin_all ON public.contract_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_contracts c
      WHERE c.id = contract_members.contract_id
        AND public.is_admin_only(c.academy_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.student_contracts c
      WHERE c.id = contract_members.contract_id
        AND public.is_admin_only(c.academy_id)
    )
  );

-- student_contract_months
DROP POLICY IF EXISTS student_contract_months_select ON public.student_contract_months;
CREATE POLICY student_contract_months_select ON public.student_contract_months
  FOR SELECT TO authenticated
  USING (
    public.can_access_student(student_id)
    OR public.is_admin_of_academy(academy_id)
  );

DROP POLICY IF EXISTS student_contract_months_admin_all ON public.student_contract_months;
CREATE POLICY student_contract_months_admin_all ON public.student_contract_months
  FOR ALL TO authenticated
  USING (public.is_admin_only(academy_id))
  WITH CHECK (public.is_admin_only(academy_id));

-- contract_payments: admin always; individual student on own contract;
-- family: only financial responsible (or admin). Dependents use months, not payment rows.
DROP POLICY IF EXISTS contract_payments_select ON public.contract_payments;
CREATE POLICY contract_payments_select ON public.contract_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_contracts c
      WHERE c.id = contract_payments.contract_id
        AND (
          public.is_admin_of_academy(c.academy_id)
          OR (c.student_id IS NOT NULL AND public.can_access_student(c.student_id))
          OR (
            c.family_group_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.family_groups g
              JOIN public.students s ON s.id = g.financial_responsible_student_id
              WHERE g.id = c.family_group_id
                AND s.profile_user_id = auth.uid()
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS contract_payments_admin_all ON public.contract_payments;
CREATE POLICY contract_payments_admin_all ON public.contract_payments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_contracts c
      WHERE c.id = contract_payments.contract_id
        AND public.is_admin_only(c.academy_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.student_contracts c
      WHERE c.id = contract_payments.contract_id
        AND public.is_admin_only(c.academy_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 8) updated_at triggers (reuse existing function if present)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS trg_upd_family_groups ON public.family_groups;
    CREATE TRIGGER trg_upd_family_groups
      BEFORE UPDATE ON public.family_groups
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS trg_upd_family_members ON public.family_members;
    CREATE TRIGGER trg_upd_family_members
      BEFORE UPDATE ON public.family_members
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS trg_upd_student_contracts ON public.student_contracts;
    CREATE TRIGGER trg_upd_student_contracts
      BEFORE UPDATE ON public.student_contracts
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS trg_upd_contract_members ON public.contract_members;
    CREATE TRIGGER trg_upd_contract_members
      BEFORE UPDATE ON public.contract_members
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
