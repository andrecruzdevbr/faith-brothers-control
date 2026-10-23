-- Attendance QR: 20-minute TTL enforced by Postgres now(), not the device clock.
-- Does not touch Production until this migration is applied by later authorization.

CREATE OR REPLACE FUNCTION public.attendance_qr_ttl()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT interval '20 minutes';
$$;

CREATE OR REPLACE FUNCTION public.attendance_qr_is_expired(
  _expires_at timestamptz,
  _as_of timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _expires_at <= _as_of;
$$;

CREATE OR REPLACE FUNCTION public.attendance_sessions_force_qr_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.started_at := now();
  IF NEW.token IS NULL OR btrim(NEW.token) = '' THEN
    NEW.token := gen_random_uuid()::text;
  END IF;
  NEW.expires_at := NEW.started_at + public.attendance_qr_ttl();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_sessions_force_qr_expiry ON public.attendance_sessions;
CREATE TRIGGER attendance_sessions_force_qr_expiry
  BEFORE INSERT ON public.attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.attendance_sessions_force_qr_expiry();

CREATE OR REPLACE FUNCTION public.attendance_sessions_lock_qr_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.token := OLD.token;
  NEW.started_at := OLD.started_at;
  NEW.expires_at := OLD.expires_at;
  NEW.academy_id := OLD.academy_id;
  NEW.professor_user_id := OLD.professor_user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_sessions_lock_qr_expiry ON public.attendance_sessions;
CREATE TRIGGER attendance_sessions_lock_qr_expiry
  BEFORE UPDATE ON public.attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.attendance_sessions_lock_qr_expiry();

CREATE OR REPLACE FUNCTION public.start_attendance_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy_id uuid;
  _row public.attendance_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT academy_id INTO _academy_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF _academy_id IS NULL THEN
    RAISE EXCEPTION 'Perfil não encontrado';
  END IF;

  IF NOT public.can_operate_ops(_academy_id) THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  UPDATE public.attendance_sessions
  SET ended_at = now()
  WHERE professor_user_id = auth.uid()
    AND academy_id = _academy_id
    AND ended_at IS NULL;

  INSERT INTO public.attendance_sessions (academy_id, professor_user_id, token)
  VALUES (_academy_id, auth.uid(), gen_random_uuid()::text)
  RETURNING * INTO _row;

  RETURN jsonb_build_object(
    'id', _row.id,
    'token', _row.token,
    'started_at', _row.started_at,
    'expires_at', _row.expires_at,
    'server_now', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.end_attendance_session(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT academy_id INTO _academy_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF _academy_id IS NULL OR NOT public.can_operate_ops(_academy_id) THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  UPDATE public.attendance_sessions
  SET ended_at = now()
  WHERE id = _session_id
    AND academy_id = _academy_id
    AND ended_at IS NULL
    AND (
      professor_user_id = auth.uid()
      OR public.is_admin_of_academy(_academy_id)
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão não encontrada';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', _session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_attendance_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _academy_id uuid;
  _row public.attendance_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT academy_id INTO _academy_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF _academy_id IS NULL OR NOT public.can_operate_ops(_academy_id) THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  SELECT * INTO _row
  FROM public.attendance_sessions
  WHERE academy_id = _academy_id
    AND professor_user_id = auth.uid()
    AND ended_at IS NULL
    AND expires_at > now()
  ORDER BY started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('session', null, 'server_now', now());
  END IF;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'id', _row.id,
      'token', _row.token,
      'started_at', _row.started_at,
      'expires_at', _row.expires_at
    ),
    'server_now', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_attendance_by_token(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session   public.attendance_sessions%ROWTYPE;
  _student   public.students%ROWTYPE;
  _existing  UUID;
  _today     DATE := CURRENT_DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF _token IS NULL OR btrim(_token) = '' THEN
    RAISE EXCEPTION 'QR Code inválido ou sessão encerrada';
  END IF;

  SELECT * INTO _session
  FROM public.attendance_sessions
  WHERE token = _token AND ended_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR Code inválido ou sessão encerrada';
  END IF;

  IF public.attendance_qr_is_expired(_session.expires_at, now()) THEN
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

REVOKE ALL ON FUNCTION public.start_attendance_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_attendance_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_attendance_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_attendance_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_attendance_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_attendance_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_qr_ttl() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_qr_is_expired(timestamptz, timestamptz) TO authenticated;
