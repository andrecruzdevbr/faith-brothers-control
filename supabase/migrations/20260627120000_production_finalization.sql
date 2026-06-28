-- ================================================================
-- FAITH BROTHERS — Production finalization migration
-- Security hardening, RBAC, WhatsApp queue, turmas, indexes
-- ================================================================

-- 1. Remove privilege escalation via phone trigger
DROP TRIGGER IF EXISTS trg_auto_assign_role ON public.profiles;
DROP TRIGGER IF EXISTS trg_auto_assign_role_by_phone ON public.profiles;
DROP FUNCTION IF EXISTS public.auto_assign_role_by_phone();

-- 2. Helper: admin-only (not professor)
CREATE OR REPLACE FUNCTION public.is_admin_only(_academy_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid()
      AND p.academy_id = _academy_id
      AND ur.role = 'admin'
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_only(UUID) TO authenticated;

-- 3. Turmas (classes)
CREATE TABLE IF NOT EXISTS public.classes (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id  UUID        NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  schedule_days TEXT      NOT NULL DEFAULT '',
  schedule_time TEXT      NOT NULL DEFAULT '',
  plan_id     UUID        REFERENCES public.plans(id) ON DELETE SET NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academy_id, name)
);

CREATE INDEX IF NOT EXISTS idx_classes_academy_id ON public.classes(academy_id);

-- 4. WhatsApp message queue / history
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id    UUID        REFERENCES public.academies(id) ON DELETE SET NULL,
  student_id    UUID        REFERENCES public.students(id) ON DELETE SET NULL,
  billing_id    UUID        REFERENCES public.billings(id) ON DELETE SET NULL,
  recipient     TEXT        NOT NULL,
  message_type  TEXT        NOT NULL DEFAULT 'general',
  body          TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'confirmed')),
  attempts      INTEGER     NOT NULL DEFAULT 0,
  max_attempts  INTEGER     NOT NULL DEFAULT 3,
  external_id   TEXT,
  error_message TEXT,
  sent_at       TIMESTAMPTZ,
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_status ON public.whatsapp_messages(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_academy ON public.whatsapp_messages(academy_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_billing ON public.whatsapp_messages(billing_id);

-- 5. OTP rate limiting table (if otp_tokens missing columns)
CREATE TABLE IF NOT EXISTS public.otp_rate_limits (
  whatsapp     TEXT        NOT NULL PRIMARY KEY,
  request_count INTEGER    NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_until TIMESTAMPTZ
);

-- Ensure otp_tokens exists with proper structure
CREATE TABLE IF NOT EXISTS public.otp_tokens (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp   TEXT        NOT NULL,
  code_hash  TEXT        NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT false,
  attempts   INTEGER     NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_tokens_whatsapp ON public.otp_tokens(whatsapp);
CREATE INDEX IF NOT EXISTS idx_otp_tokens_expires_at ON public.otp_tokens(expires_at);

-- 6. Performance indexes
CREATE INDEX IF NOT EXISTS idx_billings_academy_status ON public.billings(academy_id, status);
CREATE INDEX IF NOT EXISTS idx_billings_academy_month ON public.billings(academy_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_students_academy_status ON public.students(academy_id, status);
CREATE INDEX IF NOT EXISTS idx_attendances_student_checked ON public.attendances(student_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_billings_student_month ON public.billings(student_id, reference_month DESC);

-- Migrate otp_tokens.code -> code_hash if legacy column exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'otp_tokens' AND column_name = 'code'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'otp_tokens' AND column_name = 'code_hash'
  ) THEN
    ALTER TABLE public.otp_tokens RENAME COLUMN code TO code_hash;
  END IF;
END $$;

-- 7. Safe view: sessions without token for students
CREATE OR REPLACE VIEW public.attendance_sessions_public
WITH (security_invoker = true) AS
  SELECT id, academy_id, professor_user_id, started_at, expires_at, ended_at, created_at
  FROM public.attendance_sessions;

GRANT SELECT ON public.attendance_sessions_public TO authenticated;

-- 8. Fix academies anon access — drop full table access
DROP POLICY IF EXISTS "acad_anon_select" ON public.academies;

-- 9. Fix profile update — users cannot change academy_id or whatsapp
DROP POLICY IF EXISTS "prof_update" ON public.profiles;
CREATE POLICY "prof_update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin_of_academy(academy_id)
  )
  WITH CHECK (
    public.is_admin_of_academy(academy_id)
    OR (
      user_id = auth.uid()
      AND academy_id = (SELECT academy_id FROM public.profiles WHERE user_id = auth.uid())
      AND whatsapp IS NOT DISTINCT FROM (SELECT whatsapp FROM public.profiles WHERE user_id = auth.uid())
    )
  );

-- 10. Attendance sessions — students see public view only via policy on base table
DROP POLICY IF EXISTS "as_select" ON public.attendance_sessions;
DROP POLICY IF EXISTS "as_select_staff" ON public.attendance_sessions;
CREATE POLICY "as_select_staff"
  ON public.attendance_sessions FOR SELECT TO authenticated
  USING (public.is_admin_of_academy(academy_id));

-- Students cannot SELECT attendance_sessions directly (no token exposure)

-- 11. Remove student direct insert on attendances
DROP POLICY IF EXISTS "att_insert" ON public.attendances;

-- 12. Billings — admin-only write; staff read
DROP POLICY IF EXISTS "bill_all" ON public.billings;
DROP POLICY IF EXISTS "bill_admin_all" ON public.billings;
DROP POLICY IF EXISTS "bill_staff_select" ON public.billings;
CREATE POLICY "bill_admin_all"
  ON public.billings FOR ALL TO authenticated
  USING      (public.is_admin_only(academy_id))
  WITH CHECK (public.is_admin_only(academy_id));

CREATE POLICY "bill_staff_select"
  ON public.billings FOR SELECT TO authenticated
  USING (
    public.can_access_billing(id)
    OR public.is_admin_of_academy(academy_id)
  );

-- 13. Academy billing settings — admin only
DROP POLICY IF EXISTS "abs_all" ON public.academy_billing_settings;
DROP POLICY IF EXISTS "abs_admin_all" ON public.academy_billing_settings;
CREATE POLICY "abs_admin_all"
  ON public.academy_billing_settings FOR ALL TO authenticated
  USING      (public.is_admin_only(academy_id))
  WITH CHECK (public.is_admin_only(academy_id));

-- 14. Plans — admin write, staff read
DROP POLICY IF EXISTS "plans_all" ON public.plans;
DROP POLICY IF EXISTS "plans_admin_all" ON public.plans;
CREATE POLICY "plans_admin_all"
  ON public.plans FOR ALL TO authenticated
  USING      (public.is_admin_only(academy_id))
  WITH CHECK (public.is_admin_only(academy_id));

-- 15. User roles — admin only manage
DROP POLICY IF EXISTS "ur_insert" ON public.user_roles;
DROP POLICY IF EXISTS "ur_update" ON public.user_roles;
DROP POLICY IF EXISTS "ur_delete" ON public.user_roles;
DROP POLICY IF EXISTS "ur_admin_insert" ON public.user_roles;
DROP POLICY IF EXISTS "ur_admin_update" ON public.user_roles;
DROP POLICY IF EXISTS "ur_admin_delete" ON public.user_roles;
CREATE POLICY "ur_admin_insert"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = public.user_roles.user_id
        AND public.is_admin_only(p.academy_id)
    )
    AND public.is_admin_only((SELECT academy_id FROM public.profiles WHERE user_id = auth.uid()))
  );
CREATE POLICY "ur_admin_update"
  ON public.user_roles FOR UPDATE TO authenticated
  USING  (public.is_admin_only((SELECT academy_id FROM public.profiles WHERE user_id = auth.uid())))
  WITH CHECK (public.is_admin_only((SELECT academy_id FROM public.profiles WHERE user_id = auth.uid())));
CREATE POLICY "ur_admin_delete"
  ON public.user_roles FOR DELETE TO authenticated
  USING  (public.is_admin_only((SELECT academy_id FROM public.profiles WHERE user_id = auth.uid())));

-- 16. Classes RLS
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "classes_select" ON public.classes;
DROP POLICY IF EXISTS "classes_admin" ON public.classes;
CREATE POLICY "classes_select"
  ON public.classes FOR SELECT TO authenticated
  USING (academy_id = public.get_my_academy_id());
CREATE POLICY "classes_admin"
  ON public.classes FOR ALL TO authenticated
  USING      (public.is_admin_only(academy_id))
  WITH CHECK (public.is_admin_only(academy_id));

-- 17. WhatsApp messages RLS
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wm_admin" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "wm_student" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "wm_student_select" ON public.whatsapp_messages;
CREATE POLICY "wm_admin"
  ON public.whatsapp_messages FOR ALL TO authenticated
  USING (
    academy_id IS NULL
    OR public.is_admin_only(academy_id)
  )
  WITH CHECK (
    academy_id IS NULL
    OR public.is_admin_only(academy_id)
  );
CREATE POLICY "wm_student_select"
  ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    student_id IS NOT NULL
    AND public.can_access_student(student_id)
  );

-- OTP tokens: no client access
ALTER TABLE public.otp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;

-- 18. RPC: record attendance by token (only path for students)
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

-- 19. RPC: manage staff (admin only)
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

  DELETE FROM public.user_roles
  WHERE user_id = _target_uid AND role = 'aluno'
    AND (_roles @> ARRAY['admin'::public.app_role] OR _roles @> ARRAY['professor'::public.app_role]);

  RETURN _target_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_staff_member(TEXT, TEXT, public.app_role[]) TO authenticated;

-- 20. OTP cleanup — service_role only (create on migration path; secure grants idempotently)
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.otp_tokens WHERE expires_at < now() - INTERVAL '1 hour';
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'cleanup_expired_otps'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    REVOKE ALL ON FUNCTION public.cleanup_expired_otps() FROM authenticated;
    GRANT EXECUTE ON FUNCTION public.cleanup_expired_otps() TO service_role;
  END IF;
END $$;

-- 21. Seed default classes for Faith Brothers
INSERT INTO public.classes (academy_id, name, schedule_days, schedule_time)
SELECT a.id, v.name, v.days, v.time
FROM public.academies a
CROSS JOIN (VALUES
  ('Kids', 'Segunda / Quarta / Sexta', '18:20 às 19:30'),
  ('Adulto (Noite)', 'Segunda / Quarta / Sexta', '19:30 às 21:00'),
  ('Manhã', 'Terça / Quinta / Sexta', '10:00 às 11:30'),
  ('Tarde', 'Terça / Quinta / Sexta', '14:00 às 14:50'),
  ('Adulto (Noite TT)', 'Terça / Quinta', '19:30 às 21:00')
) AS v(name, days, time)
WHERE a.slug = 'faith-brothers'
ON CONFLICT (academy_id, name) DO NOTHING;
