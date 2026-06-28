
-- 1. Add 'professor' to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'professor';

-- 2. Replace the auto_assign trigger function to use phone (whatsapp) for role assignment
CREATE OR REPLACE FUNCTION public.auto_assign_role_by_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _whatsapp text;
  _assigned_role app_role;
BEGIN
  _whatsapp := NEW.whatsapp;

  IF _whatsapp IS NULL OR btrim(_whatsapp) = '' THEN
    RETURN NEW;
  END IF;

  -- Normalize: remove spaces, dashes, parentheses for comparison
  _whatsapp := regexp_replace(btrim(_whatsapp), '[\s\-\(\)]', '', 'g');

  -- Admin phones
  IF _whatsapp IN ('+5531993082330', '5531993082330', '31993082330') THEN
    _assigned_role := 'admin';
  -- Professor phones
  ELSIF _whatsapp IN (
    '+5531998565661', '5531998565661', '31998565661',
    '+5531981044156', '5531981044156', '31981044156',
    '+5531987540515', '5531987540515', '31987540515',
    '+5531997586456', '5531997586456', '31997586456',
    '+5531987438874', '5531987438874', '31987438874'
  ) THEN
    _assigned_role := 'professor';
  ELSE
    RETURN NEW;
  END IF;

  -- Insert role if not already present
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, _assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- If assigning admin or professor, remove aluno role if it was auto-assigned
  IF _assigned_role IN ('admin', 'professor') THEN
    DELETE FROM public.user_roles
    WHERE user_id = NEW.user_id AND role = 'aluno';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Create trigger on profiles table (fires after insert/update so we have whatsapp)
DROP TRIGGER IF EXISTS trg_auto_assign_role_by_phone ON public.profiles;
CREATE TRIGGER trg_auto_assign_role_by_phone
AFTER INSERT OR UPDATE OF whatsapp ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_role_by_phone();

-- 4. Drop old auth.users trigger (it was on a reserved schema anyway)
DROP TRIGGER IF EXISTS trg_auto_assign_admin ON auth.users;

-- 5. Update complete_student_signup to trigger role check after profile upsert
-- The trigger on profiles will handle role assignment automatically

-- 6. Fix existing users: assign roles based on current whatsapp in profiles
DO $$
DECLARE
  rec RECORD;
  _phone text;
  _role app_role;
BEGIN
  FOR rec IN SELECT user_id, whatsapp FROM public.profiles WHERE whatsapp IS NOT NULL LOOP
    _phone := regexp_replace(btrim(rec.whatsapp), '[\s\-\(\)]', '', 'g');

    IF _phone IN ('+5531993082330', '5531993082330', '31993082330') THEN
      _role := 'admin';
    ELSIF _phone IN (
      '+5531998565661', '5531998565661', '31998565661',
      '+5531981044156', '5531981044156', '31981044156',
      '+5531987540515', '5531987540515', '31987540515',
      '+5531997586456', '5531997586456', '31997586456',
      '+5531987438874', '5531987438874', '31987438874'
    ) THEN
      _role := 'professor';
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (rec.user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Remove aluno role for admins/professors
    DELETE FROM public.user_roles
    WHERE user_id = rec.user_id AND role = 'aluno';
  END LOOP;
END $$;
