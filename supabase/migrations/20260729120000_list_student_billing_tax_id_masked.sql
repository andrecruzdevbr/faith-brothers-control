-- Staff da academia (admin ou professor) + listagem mascarada de CPF/CNPJ.

CREATE OR REPLACE FUNCTION public.is_staff_of_academy(_academy_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.academy_id = _academy_id
      AND (
        public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'professor')
      )
  )
$$;

REVOKE ALL ON FUNCTION public.is_staff_of_academy(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff_of_academy(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_staff_of_academy(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff_of_academy(UUID) TO service_role;

-- Leitura mascarada: aluno dono OU staff da academia
CREATE OR REPLACE FUNCTION public.get_student_billing_tax_id_masked(_student_id UUID)
RETURNS TABLE (masked TEXT, has_tax_id BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = _student_id
      AND (
        s.profile_user_id = auth.uid()
        OR public.is_staff_of_academy(s.academy_id)
      )
  ) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    public.mask_tax_id(sbp.tax_id),
    COALESCE(sbp.tax_id IS NOT NULL AND sbp.tax_id <> '', FALSE)
  FROM public.students s
  LEFT JOIN public.student_billing_profiles sbp ON sbp.student_id = s.id
  WHERE s.id = _student_id;
END;
$$;

-- Upsert: apenas staff da academia do aluno
CREATE OR REPLACE FUNCTION public.upsert_student_billing_tax_id(
  _student_id UUID,
  _tax_id     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean TEXT;
  _academy UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.academy_id INTO _academy
  FROM public.students s
  WHERE s.id = _student_id;

  IF _academy IS NULL OR NOT public.is_staff_of_academy(_academy) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = 'P0001';
  END IF;

  _clean := public.normalize_tax_id(_tax_id);

  IF _clean IS NULL OR NOT public.is_valid_tax_id(_clean) THEN
    RAISE EXCEPTION 'CPF ou CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_billing_profiles sbp
    WHERE sbp.tax_id = _clean
      AND sbp.student_id <> _student_id
  ) THEN
    RAISE EXCEPTION 'Este CPF/CNPJ já está cadastrado para outro aluno.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.student_billing_profiles (student_id, tax_id)
  VALUES (_student_id, _clean)
  ON CONFLICT (student_id) DO UPDATE
    SET tax_id = EXCLUDED.tax_id,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.list_student_billing_tax_id_masked(_academy_id UUID)
RETURNS TABLE (student_id UUID, masked TEXT, has_tax_id BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_staff_of_academy(_academy_id) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    public.mask_tax_id(sbp.tax_id),
    COALESCE(sbp.tax_id IS NOT NULL AND length(sbp.tax_id) > 0, FALSE)
  FROM public.students s
  LEFT JOIN public.student_billing_profiles sbp ON sbp.student_id = s.id
  WHERE s.academy_id = _academy_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_student_billing_tax_id_masked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_student_billing_tax_id_masked(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_student_billing_tax_id_masked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_student_billing_tax_id_masked(UUID) TO service_role;
