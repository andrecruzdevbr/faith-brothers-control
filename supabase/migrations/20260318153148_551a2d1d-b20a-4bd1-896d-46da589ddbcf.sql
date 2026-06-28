
-- Update is_admin_of_academy to also allow professors
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
      AND ur.role IN ('admin', 'professor')
  )
$$;
