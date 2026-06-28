-- ================================================================
-- FAITH BROTHERS — BLOCO 5: RPCs (chamadas do frontend)
-- Pré-requisito: BLOCO 4 executado
-- CREATE OR REPLACE — seguro reexecutar
-- ================================================================

-- get_public_academies: usado na tela de cadastro (sem login)
CREATE OR REPLACE FUNCTION public.get_public_academies()
RETURNS TABLE (id uuid, name text, slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.name, a.slug
  FROM public.academies a
  ORDER BY a.name ASC
$$;

-- get_my_role: retorna o papel do usuário logado como string
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role::text FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1
$$;

-- complete_student_signup: cria profile + role + student de uma só vez
-- CORREÇÃO: cast explícito de 'pendente_aprovacao' (não depende de inferência)
CREATE OR REPLACE FUNCTION public.complete_student_signup(
  _academy_id UUID,
  _full_name  TEXT,
  _whatsapp   TEXT    DEFAULT NULL,
  _belt       TEXT    DEFAULT 'Branca',
  _degrees    INTEGER DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _nw text;
  _cn text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.academies WHERE id = _academy_id) THEN
    RAISE EXCEPTION 'Academia inválida';
  END IF;

  _cn := left(btrim(_full_name), 120);
  _nw := NULLIF(left(btrim(COALESCE(_whatsapp, '')), 30), '');

  -- Verificar duplicidade de WhatsApp
  IF _nw IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE regexp_replace(btrim(COALESCE(whatsapp, '')), '[^0-9]', '', 'g')
          = regexp_replace(btrim(_nw), '[^0-9]', '', 'g')
      AND user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'WhatsApp já cadastrado para outro usuário';
  END IF;

  -- Upsert profile
  INSERT INTO public.profiles (user_id, academy_id, full_name, whatsapp)
  VALUES (auth.uid(), _academy_id, _cn, _nw)
  ON CONFLICT (user_id) DO UPDATE
    SET academy_id = EXCLUDED.academy_id,
        full_name  = EXCLUDED.full_name,
        whatsapp   = EXCLUDED.whatsapp,
        updated_at = now();

  -- Atribuir 'aluno' apenas se ainda não tiver nenhum papel
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (auth.uid(), 'aluno'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Criar registro em students (necessário para marcar presença)
  INSERT INTO public.students (
    academy_id, profile_user_id, full_name, whatsapp, belt, degrees, status
  ) VALUES (
    _academy_id, auth.uid(), _cn,
    COALESCE(_nw, ''),
    COALESCE(NULLIF(btrim(_belt), ''), 'Branca'),
    COALESCE(_degrees, 0),
    'pendente_aprovacao'::public.student_status
  )
  ON CONFLICT (profile_user_id) DO UPDATE
    SET full_name  = EXCLUDED.full_name,
        whatsapp   = EXCLUDED.whatsapp,
        belt       = EXCLUDED.belt,
        updated_at = now()
  WHERE public.students.status = 'pendente_aprovacao'::public.student_status;
END;
$$;

-- approve_student: admin/professor aprova ou rejeita aluno
CREATE OR REPLACE FUNCTION public.approve_student(
  _student_id UUID,
  _approve    boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _aid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT academy_id INTO _aid FROM public.students WHERE id = _student_id;
  IF _aid IS NULL THEN RAISE EXCEPTION 'Aluno não encontrado'; END IF;
  IF NOT public.is_admin_of_academy(_aid) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE public.students
  SET status = CASE WHEN _approve
                    THEN 'ativo'::public.student_status
                    ELSE 'rejeitado'::public.student_status
               END,
      updated_at = now()
  WHERE id = _student_id;
END;
$$;

-- update_student_graduation: admin/professor altera faixa e graus
CREATE OR REPLACE FUNCTION public.update_student_graduation(
  _student_id UUID,
  _belt       text,
  _degrees    integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _aid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _belt NOT IN ('Branca','Cinza','Amarela','Laranja','Verde','Azul','Roxa','Marrom','Preta') THEN
    RAISE EXCEPTION 'Faixa inválida: %', _belt;
  END IF;
  IF _degrees < 0 OR _degrees > 4 THEN
    RAISE EXCEPTION 'Graus deve ser entre 0 e 4';
  END IF;
  SELECT academy_id INTO _aid FROM public.students WHERE id = _student_id;
  IF _aid IS NULL THEN RAISE EXCEPTION 'Aluno não encontrado'; END IF;
  IF NOT public.is_admin_of_academy(_aid) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE public.students
  SET belt = _belt, degrees = _degrees, updated_at = now()
  WHERE id = _student_id;
END;
$$;

-- Grants para RPCs chamadas pelo frontend
GRANT EXECUTE ON FUNCTION public.get_public_academies()                            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role()                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_student_signup(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_student(UUID, boolean)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_student_graduation(UUID, text, integer)    TO authenticated;

-- record_attendance_by_token: aluno registra presença via QR (validação server-side)
CREATE OR REPLACE FUNCTION public.record_attendance_by_token(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _session   public.attendance_sessions%ROWTYPE;
  _student   public.students%ROWTYPE;
  _existing  UUID;
  _today     DATE := CURRENT_DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT * INTO _session
  FROM public.attendance_sessions
  WHERE token = _token AND ended_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR Code inválido ou sessão encerrada';
  END IF;

  IF _session.expires_at < now() THEN
    RAISE EXCEPTION 'QR Code expirado';
  END IF;

  SELECT * INTO _student
  FROM public.students
  WHERE profile_user_id = auth.uid()
    AND academy_id = _session.academy_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado nesta academia';
  END IF;

  IF _student.status <> 'ativo' THEN
    RAISE EXCEPTION 'Aluno não está ativo para registrar presença';
  END IF;

  SELECT id INTO _existing
  FROM public.attendances
  WHERE student_id = _student.id
    AND checked_in_at >= _today
    AND checked_in_at < _today + 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Presença já registrada hoje';
  END IF;

  INSERT INTO public.attendances (session_id, student_id, academy_id)
  VALUES (_session.id, _student.id, _session.academy_id);

  RETURN jsonb_build_object(
    'success', true,
    'student_id', _student.id,
    'session_id', _session.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_attendance_by_token(TEXT) TO authenticated;

-- manage_staff_member: admin gerencia papéis admin/professor
CREATE OR REPLACE FUNCTION public.manage_staff_member(
  _whatsapp   TEXT,
  _full_name  TEXT,
  _roles      public.app_role[]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _academy_id UUID;
  _clean      TEXT;
  _target_uid UUID;
  _role       public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  _academy_id := public.get_my_academy_id();
  IF NOT public.is_admin_only(_academy_id) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  _clean := regexp_replace(btrim(_whatsapp), '[^0-9]', '', 'g');
  IF length(_clean) >= 12 AND _clean LIKE '55%' THEN
    _clean := substring(_clean FROM 3);
  END IF;

  SELECT user_id INTO _target_uid
  FROM public.profiles
  WHERE regexp_replace(btrim(COALESCE(whatsapp, '')), '[^0-9]', '', 'g') = _clean
  LIMIT 1;

  IF _target_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado. O membro deve criar conta primeiro.';
  END IF;

  IF (SELECT academy_id FROM public.profiles WHERE user_id = _target_uid) <> _academy_id THEN
    RAISE EXCEPTION 'Usuário pertence a outra academia';
  END IF;

  UPDATE public.profiles
  SET full_name = left(btrim(_full_name), 120), updated_at = now()
  WHERE user_id = _target_uid;

  DELETE FROM public.user_roles
  WHERE user_id = _target_uid AND role IN ('admin', 'professor');

  FOREACH _role IN ARRAY _roles LOOP
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_uid, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;

  RETURN _target_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_staff_member(TEXT, TEXT, public.app_role[]) TO authenticated;

-- Verificação: deve listar as 7 RPCs
SELECT proname
FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND proname IN (
    'get_public_academies', 'get_my_role', 'complete_student_signup',
    'approve_student', 'update_student_graduation',
    'record_attendance_by_token', 'manage_staff_member'
  )
ORDER BY proname;
