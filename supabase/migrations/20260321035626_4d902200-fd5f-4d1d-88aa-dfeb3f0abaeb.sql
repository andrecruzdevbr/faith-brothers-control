
-- =============================================
-- Attendance sessions (QR code sessions by professor)
-- =============================================
CREATE TABLE public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id uuid NOT NULL REFERENCES public.academies(id),
  professor_user_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage attendance sessions"
  ON public.attendance_sessions FOR ALL TO authenticated
  USING (is_admin_of_academy(academy_id))
  WITH CHECK (is_admin_of_academy(academy_id));

CREATE POLICY "Students can view sessions from own academy"
  ON public.attendance_sessions FOR SELECT TO authenticated
  USING (academy_id = get_my_academy_id());

-- =============================================
-- Attendances (student check-ins)
-- =============================================
CREATE TABLE public.attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id),
  student_id uuid NOT NULL REFERENCES public.students(id),
  academy_id uuid NOT NULL REFERENCES public.academies(id),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);

ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage attendances"
  ON public.attendances FOR ALL TO authenticated
  USING (is_admin_of_academy(academy_id))
  WITH CHECK (is_admin_of_academy(academy_id));

CREATE POLICY "Students can view own attendances"
  ON public.attendances FOR SELECT TO authenticated
  USING (can_access_student(student_id));

CREATE POLICY "Students can insert own attendance"
  ON public.attendances FOR INSERT TO authenticated
  WITH CHECK (
    can_access_student(student_id)
    AND academy_id = get_my_academy_id()
  );

-- =============================================
-- Update auto_assign_role_by_phone to use DDD+number format
-- =============================================
CREATE OR REPLACE FUNCTION public.auto_assign_role_by_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _whatsapp text;
  _clean text;
  _assigned_role app_role;
BEGIN
  _whatsapp := NEW.whatsapp;

  IF _whatsapp IS NULL OR btrim(_whatsapp) = '' THEN
    RETURN NEW;
  END IF;

  _clean := regexp_replace(btrim(_whatsapp), '[^0-9]', '', 'g');

  -- Remove country code 55 if present
  IF length(_clean) >= 12 AND _clean LIKE '55%' THEN
    _clean := substring(_clean from 3);
  END IF;

  IF _clean IN (
    '31981044156',
    '31998565661',
    '31987540515',
    '31997586456',
    '31987438874'
  ) THEN
    _assigned_role := 'admin';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, _assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = NEW.user_id AND role = 'aluno';

  RETURN NEW;
END;
$$;

-- Recreate the trigger on profiles
DROP TRIGGER IF EXISTS trg_auto_assign_role ON public.profiles;
CREATE TRIGGER trg_auto_assign_role
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_role_by_phone();
