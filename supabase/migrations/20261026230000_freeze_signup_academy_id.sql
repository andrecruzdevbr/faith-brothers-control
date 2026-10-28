-- Freeze academy_id on complete_student_signup conflict.
-- A second call must not rebind an existing profile to another academy.
-- Recovery: restore function body from 20260320025225_8da08d88-57e1-4173-9de1-8d11f594bd7d.sql

CREATE OR REPLACE FUNCTION public.complete_student_signup(
  _academy_id uuid,
  _full_name text,
  _whatsapp text DEFAULT NULL::text
)
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
  VALUES (
    auth.uid(),
    _academy_id,
    left(btrim(_full_name), 120),
    NULLIF(left(btrim(COALESCE(_whatsapp, '')), 30), '')
  )
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        whatsapp = EXCLUDED.whatsapp,
        updated_at = now();
        -- academy_id is intentionally not updated

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'aluno'
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (auth.uid(), 'aluno');
  END IF;
END;
$function$;
