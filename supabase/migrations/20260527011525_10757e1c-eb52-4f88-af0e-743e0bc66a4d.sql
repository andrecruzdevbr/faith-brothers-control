CREATE OR REPLACE FUNCTION public.auto_assign_role_by_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  IF length(_clean) >= 12 AND _clean LIKE '55%' THEN
    _clean := substring(_clean from 3);
  END IF;

  IF _clean = '31993082330' THEN
    _assigned_role := 'admin';
  ELSIF _clean IN ('31981044156','31987540515','31998565661','31997586456','31987438874') THEN
    _assigned_role := 'professor';
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

-- Backfill: realinhar usuários existentes
DO $$
DECLARE
  r RECORD;
  _clean text;
  _target app_role;
BEGIN
  FOR r IN SELECT user_id, whatsapp FROM public.profiles WHERE whatsapp IS NOT NULL LOOP
    _clean := regexp_replace(btrim(r.whatsapp), '[^0-9]', '', 'g');
    IF length(_clean) >= 12 AND _clean LIKE '55%' THEN
      _clean := substring(_clean from 3);
    END IF;

    IF _clean = '31993082330' THEN
      _target := 'admin';
    ELSIF _clean IN ('31981044156','31987540515','31998565661','31997586456','31987438874') THEN
      _target := 'professor';
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (r.user_id, _target)
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = r.user_id AND role <> _target;
  END LOOP;
END $$;