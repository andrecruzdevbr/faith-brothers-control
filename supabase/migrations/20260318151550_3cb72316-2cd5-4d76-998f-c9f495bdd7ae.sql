
-- Trigger function: auto-assign admin role for specific emails
CREATE OR REPLACE FUNCTION public.auto_assign_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email text;
BEGIN
  _email := NEW.email;

  IF _email IN ('andredouglascruz@gmail.com') THEN
    -- Ensure profile exists (may not yet if signup flow hasn't completed)
    -- We only set the role here; profile is handled by complete_student_signup or manually
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users on insert
CREATE OR REPLACE TRIGGER trg_auto_assign_admin
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_admin_role();
