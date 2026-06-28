-- RPCs de aprovação e rejeição de alunos pendentes (staff da mesma academia)

CREATE OR REPLACE FUNCTION public.approve_student(
  _student_id UUID,
  _approve    BOOLEAN DEFAULT TRUE
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id, s.status
  INTO _academy_id, _current_status
  FROM public.students s
  WHERE s.id = _student_id;

  IF _academy_id IS NULL THEN
    RAISE EXCEPTION 'Aluno não encontrado'
      USING ERRCODE = 'P0001';
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

  _new_status := CASE
    WHEN _approve THEN 'ativo'::public.student_status
    ELSE 'rejeitado'::public.student_status
  END;

  UPDATE public.students
  SET status = _new_status,
      updated_at = now()
  WHERE id = _student_id
    AND status = 'pendente_aprovacao'::public.student_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_student(
  _student_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy_id UUID;
  _current_status public.student_status;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id, s.status
  INTO _academy_id, _current_status
  FROM public.students s
  WHERE s.id = _student_id;

  IF _academy_id IS NULL THEN
    RAISE EXCEPTION 'Aluno não encontrado'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid()
      AND p.academy_id = _academy_id
      AND ur.role IN ('admin', 'professor')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: somente admin ou professor da academia pode rejeitar alunos'
      USING ERRCODE = 'P0001';
  END IF;

  IF _current_status IS DISTINCT FROM 'pendente_aprovacao'::public.student_status THEN
    RAISE EXCEPTION 'Aluno não está pendente de aprovação (status atual: %)', _current_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.students
  SET status = 'rejeitado'::public.student_status,
      updated_at = now()
  WHERE id = _student_id
    AND status = 'pendente_aprovacao'::public.student_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível processar o cadastro do aluno'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_student(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_student(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_student(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_student(UUID, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.reject_student(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_student(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_student(UUID) TO service_role;
