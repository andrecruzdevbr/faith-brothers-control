CREATE OR REPLACE FUNCTION public.get_public_academies()
RETURNS TABLE (id uuid, name text, slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.slug
  FROM public.academies a
  ORDER BY a.name ASC
$$;

CREATE OR REPLACE FUNCTION public.complete_student_signup(
  _academy_id uuid,
  _full_name text,
  _whatsapp text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RAISE EXCEPTION 'Nome é obrigatório';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.academies
    WHERE id = _academy_id
  ) THEN
    RAISE EXCEPTION 'Academia inválida';
  END IF;

  INSERT INTO public.profiles (user_id, academy_id, full_name, whatsapp)
  VALUES (auth.uid(), _academy_id, left(btrim(_full_name), 120), NULLIF(left(btrim(COALESCE(_whatsapp, '')), 30), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET academy_id = EXCLUDED.academy_id,
        full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        updated_at = now();

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'aluno'
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (auth.uid(), 'aluno');
  END IF;
END;
$$;