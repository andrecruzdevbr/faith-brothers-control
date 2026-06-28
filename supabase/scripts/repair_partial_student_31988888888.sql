-- Reparo idempotente: aluno parcial 31988888888@wa.faithbrothers.app
-- Preserva auth.users e profiles; cria user_roles (aluno) e students se faltarem.
-- Não altera administradores nem outros alunos. Seguro reexecutar.

DO $$
DECLARE
  _uid        UUID;
  _academy_id UUID;
  _wa         TEXT := '31988888888';
  _name       TEXT := 'Aluno Teste Faith Brothers';
BEGIN
  SELECT u.id
  INTO _uid
  FROM auth.users u
  WHERE u.email = '31988888888@wa.faithbrothers.app'
  LIMIT 1;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Usuário auth não encontrado para 31988888888@wa.faithbrothers.app';
  END IF;

  SELECT p.academy_id
  INTO _academy_id
  FROM public.profiles p
  WHERE p.user_id = _uid
  LIMIT 1;

  IF _academy_id IS NULL THEN
    SELECT a.id
    INTO _academy_id
    FROM public.academies a
    WHERE a.name ILIKE 'Faith Brothers BJJ%'
    ORDER BY a.name
    LIMIT 1;
  END IF;

  IF _academy_id IS NULL THEN
    RAISE EXCEPTION 'Academia não encontrada para o aluno parcial';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_uid, 'aluno'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.students (
    academy_id,
    profile_user_id,
    full_name,
    whatsapp,
    belt,
    degrees,
    status
  )
  VALUES (
    _academy_id,
    _uid,
    _name,
    _wa,
    'Branca',
    0,
    'pendente_aprovacao'::public.student_status
  )
  ON CONFLICT (profile_user_id) DO UPDATE
    SET
      full_name  = EXCLUDED.full_name,
      whatsapp   = EXCLUDED.whatsapp,
      belt       = COALESCE(public.students.belt, EXCLUDED.belt),
      updated_at = now()
  WHERE public.students.status = 'pendente_aprovacao'::public.student_status;

  RAISE NOTICE 'Reparo concluído para user_id=% student_id=%',
    _uid,
    (SELECT s.id FROM public.students s WHERE s.profile_user_id = _uid LIMIT 1);
END $$;
