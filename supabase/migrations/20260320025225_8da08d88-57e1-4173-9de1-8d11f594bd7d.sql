-- Update auto_assign_role_by_phone to only use 'admin' (no more 'professor' role distinction)
CREATE OR REPLACE FUNCTION public.auto_assign_role_by_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _whatsapp text;
  _assigned_role app_role;
BEGIN
  _whatsapp := NEW.whatsapp;

  IF _whatsapp IS NULL OR btrim(_whatsapp) = '' THEN
    RETURN NEW;
  END IF;

  _whatsapp := regexp_replace(btrim(_whatsapp), '[\s\-\(\)]', '', 'g');

  -- All admin/professor phones get 'admin' role
  IF _whatsapp IN (
    '+5531993082330', '5531993082330', '31993082330',
    '+5531998565661', '5531998565661', '31998565661',
    '+5531981044156', '5531981044156', '31981044156',
    '+5531987540515', '5531987540515', '31987540515',
    '+5531997586456', '5531997586456', '31997586456',
    '+5531987438874', '5531987438874', '31987438874'
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
$function$;

-- Update complete_student_signup with WhatsApp duplicate check
CREATE OR REPLACE FUNCTION public.complete_student_signup(_academy_id uuid, _full_name text, _whatsapp text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.academies WHERE id = _academy_id
  ) THEN
    RAISE EXCEPTION 'Academia inválida';
  END IF;

  IF _whatsapp IS NOT NULL AND btrim(_whatsapp) != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE regexp_replace(btrim(whatsapp), '[\s\-\(\)]', '', 'g') = regexp_replace(btrim(_whatsapp), '[\s\-\(\)]', '', 'g')
        AND user_id != auth.uid()
    ) THEN
      RAISE EXCEPTION 'Este WhatsApp já está cadastrado para outro usuário';
    END IF;
  END IF;

  INSERT INTO public.profiles (user_id, academy_id, full_name, whatsapp)
  VALUES (auth.uid(), _academy_id, left(btrim(_full_name), 120), NULLIF(left(btrim(COALESCE(_whatsapp, '')), 30), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET academy_id = EXCLUDED.academy_id,
        full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        updated_at = now();

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'aluno'
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (auth.uid(), 'aluno');
  END IF;
END;
$function$;

-- Update is_admin_of_academy to only check 'admin' role
CREATE OR REPLACE FUNCTION public.is_admin_of_academy(_academy_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid()
      AND p.academy_id = _academy_id
      AND ur.role = 'admin'
  )
$$