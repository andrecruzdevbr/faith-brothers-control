-- Planos reais da academia + solicitações de troca com aprovação do admin

-- 1) Garantir os 3 planos ativos em todas as academias (sem duplicar por nome)
INSERT INTO public.plans (academy_id, name, monthly_price, training_days_per_week, active)
SELECT a.id, v.name, v.monthly_price, v.training_days_per_week, TRUE
FROM public.academies a
CROSS JOIN (
  VALUES
    ('Plano 2 dias por semana'::text, 210.00::numeric, 2),
    ('Plano 3 dias por semana', 230.00, 3),
    ('Plano 5 dias por semana', 250.00, 5)
) AS v(name, monthly_price, training_days_per_week)
ON CONFLICT (academy_id, name) DO UPDATE
SET
  monthly_price = EXCLUDED.monthly_price,
  training_days_per_week = EXCLUDED.training_days_per_week,
  active = TRUE,
  updated_at = now();

-- Desativar planos de teste óbvios (ex.: R$ 10) que não são os 3 oficiais
UPDATE public.plans p
SET active = FALSE,
    updated_at = now()
WHERE p.active = TRUE
  AND p.name NOT IN (
    'Plano 2 dias por semana',
    'Plano 3 dias por semana',
    'Plano 5 dias por semana'
  )
  AND (
    p.monthly_price = 10.00
    OR lower(p.name) LIKE '%teste%'
    OR lower(p.name) LIKE '%test%'
  );

-- 2) Status da solicitação
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'plan_change_request_status'
  ) THEN
    CREATE TYPE public.plan_change_request_status AS ENUM (
      'pending',
      'approved',
      'rejected'
    );
  END IF;
END $$;

-- 3) Tabela de solicitações (plano atual continua em students.plan_id)
CREATE TABLE IF NOT EXISTS public.student_plan_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  current_plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  requested_plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by_role TEXT NOT NULL CHECK (requested_by_role IN ('admin', 'professor', 'aluno')),
  status public.plan_change_request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_plan_change_requests_different_plan
    CHECK (current_plan_id IS DISTINCT FROM requested_plan_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS student_plan_change_requests_one_pending
  ON public.student_plan_change_requests (student_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_student_plan_change_requests_student
  ON public.student_plan_change_requests (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_plan_change_requests_status
  ON public.student_plan_change_requests (status);

DROP TRIGGER IF EXISTS update_student_plan_change_requests_updated_at
  ON public.student_plan_change_requests;
CREATE TRIGGER update_student_plan_change_requests_updated_at
  BEFORE UPDATE ON public.student_plan_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.student_plan_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_change_requests_staff_select" ON public.student_plan_change_requests;
CREATE POLICY "plan_change_requests_staff_select"
  ON public.student_plan_change_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = student_id
        AND public.is_staff_of_academy(s.academy_id)
    )
  );

DROP POLICY IF EXISTS "plan_change_requests_student_select" ON public.student_plan_change_requests;
CREATE POLICY "plan_change_requests_student_select"
  ON public.student_plan_change_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = student_id
        AND s.profile_user_id = auth.uid()
    )
  );

-- Mutações apenas via RPCs SECURITY DEFINER (sem INSERT/UPDATE diretos)

-- Admin altera plano direto; cancela solicitação pendente
CREATE OR REPLACE FUNCTION public.update_student_plan(
  _student_id UUID,
  _plan_id    UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id INTO _academy
  FROM public.students s
  WHERE s.id = _student_id;

  IF _academy IS NULL OR NOT public.is_admin_of_academy(_academy) THEN
    RAISE EXCEPTION 'Acesso negado: somente admin pode alterar o plano diretamente.'
      USING ERRCODE = 'P0001';
  END IF;

  IF _plan_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.plans p
      WHERE p.id = _plan_id
        AND p.academy_id = _academy
        AND p.active = TRUE
    ) THEN
      RAISE EXCEPTION 'Plano inválido ou inativo para esta academia.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.students
  SET plan_id = _plan_id,
      updated_at = now()
  WHERE id = _student_id;

  UPDATE public.student_plan_change_requests
  SET status = 'rejected'::public.plan_change_request_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE student_id = _student_id
    AND status = 'pending'::public.plan_change_request_status;
END;
$$;

REVOKE ALL ON FUNCTION public.update_student_plan(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_student_plan(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_student_plan(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_student_plan(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.request_student_plan_change(
  _student_id UUID,
  _requested_plan_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy UUID;
  _current_plan UUID;
  _profile_user UUID;
  _role TEXT;
  _request_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF _requested_plan_id IS NULL THEN
    RAISE EXCEPTION 'Selecione o novo plano.' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id, s.plan_id, s.profile_user_id
  INTO _academy, _current_plan, _profile_user
  FROM public.students s
  WHERE s.id = _student_id;

  IF _academy IS NULL THEN
    RAISE EXCEPTION 'Aluno não encontrado' USING ERRCODE = 'P0001';
  END IF;

  IF public.is_admin_of_academy(_academy) THEN
    _role := 'admin';
  ELSIF public.is_staff_of_academy(_academy) THEN
    _role := 'professor';
  ELSIF _profile_user IS NOT NULL AND _profile_user = auth.uid() THEN
    _role := 'aluno';
  ELSE
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = _requested_plan_id
      AND p.academy_id = _academy
      AND p.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Plano inválido ou inativo para esta academia.'
      USING ERRCODE = 'P0001';
  END IF;

  IF _current_plan IS NOT DISTINCT FROM _requested_plan_id THEN
    RAISE EXCEPTION 'O aluno já está neste plano.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_plan_change_requests r
    WHERE r.student_id = _student_id
      AND r.status = 'pending'::public.plan_change_request_status
  ) THEN
    RAISE EXCEPTION 'Já existe uma solicitação de mudança de plano aguardando aprovação.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.student_plan_change_requests (
    student_id,
    current_plan_id,
    requested_plan_id,
    requested_by,
    requested_by_role,
    status
  )
  VALUES (
    _student_id,
    _current_plan,
    _requested_plan_id,
    auth.uid(),
    _role,
    'pending'::public.plan_change_request_status
  )
  RETURNING id INTO _request_id;

  RETURN _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_student_plan_change(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_student_plan_change(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_student_plan_change(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_student_plan_change(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_student_plan_change(_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy UUID;
  _student_id UUID;
  _requested_plan UUID;
  _status public.plan_change_request_status;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.student_id, r.requested_plan_id, r.status, s.academy_id
  INTO _student_id, _requested_plan, _status, _academy
  FROM public.student_plan_change_requests r
  JOIN public.students s ON s.id = r.student_id
  WHERE r.id = _request_id;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin_of_academy(_academy) THEN
    RAISE EXCEPTION 'Acesso negado: somente admin pode aprovar mudança de plano.'
      USING ERRCODE = 'P0001';
  END IF;

  IF _status IS DISTINCT FROM 'pending'::public.plan_change_request_status THEN
    RAISE EXCEPTION 'Solicitação não está pendente.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = _requested_plan
      AND p.academy_id = _academy
      AND p.active = TRUE
  ) THEN
    RAISE EXCEPTION 'Plano solicitado inválido ou inativo.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.students
  SET plan_id = _requested_plan,
      updated_at = now()
  WHERE id = _student_id;

  UPDATE public.student_plan_change_requests
  SET status = 'approved'::public.plan_change_request_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = _request_id
    AND status = 'pending'::public.plan_change_request_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível aprovar a solicitação.' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_student_plan_change(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_student_plan_change(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_student_plan_change(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_student_plan_change(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.reject_student_plan_change(_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy UUID;
  _student_id UUID;
  _status public.plan_change_request_status;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.student_id, r.status, s.academy_id
  INTO _student_id, _status, _academy
  FROM public.student_plan_change_requests r
  JOIN public.students s ON s.id = r.student_id
  WHERE r.id = _request_id;

  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin_of_academy(_academy) THEN
    RAISE EXCEPTION 'Acesso negado: somente admin pode recusar mudança de plano.'
      USING ERRCODE = 'P0001';
  END IF;

  IF _status IS DISTINCT FROM 'pending'::public.plan_change_request_status THEN
    RAISE EXCEPTION 'Solicitação não está pendente.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.student_plan_change_requests
  SET status = 'rejected'::public.plan_change_request_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = _request_id
    AND status = 'pending'::public.plan_change_request_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível recusar a solicitação.' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_student_plan_change(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_student_plan_change(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_student_plan_change(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_student_plan_change(UUID) TO service_role;
