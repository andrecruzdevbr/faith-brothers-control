-- Cliente: desativar Herbert/Lanes, limitar WhatsApp da academia, atualizar endereço.
-- Não apaga histórico (presenças, cobranças, etc.). Não aplicar em produção sem revisão.

CREATE OR REPLACE FUNCTION public.is_academy_limited_of(_academy_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid()
      AND p.academy_id = _academy_id
      AND ur.role = 'academy_limited'::public.app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_operate_ops(_academy_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin_of_academy(_academy_id)
      OR public.is_academy_limited_of(_academy_id);
$$;

COMMENT ON FUNCTION public.is_academy_limited_of(UUID) IS
  'True se o usuário autenticado tem role academy_limited na academia.';
COMMENT ON FUNCTION public.can_operate_ops(UUID) IS
  'Admin/professor ou academy_limited — operações de turmas/presenças/graduação/ranking.';

GRANT EXECUTE ON FUNCTION public.is_academy_limited_of(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_operate_ops(UUID) TO authenticated;

-- academy_limited NÃO pode SELECT a linha completa de academies (banco/financeiro/técnico).
-- Admin/professor (is_admin_of_academy) e demais membros (ex.: aluno) mantêm SELECT.
DROP POLICY IF EXISTS "acad_auth_select" ON public.academies;
CREATE POLICY "acad_auth_select"
  ON public.academies FOR SELECT TO authenticated
  USING (
    id = public.get_my_academy_id()
    AND (
      public.is_admin_of_academy(id)
      OR NOT public.is_academy_limited_of(id)
    )
  );

-- Fonte segura para Configurações básicas (somente campos não sensíveis).
CREATE OR REPLACE FUNCTION public.get_my_academy_basic_info()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  city TEXT,
  state TEXT,
  address TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_academy_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  v_academy_id := public.get_my_academy_id();
  IF v_academy_id IS NULL THEN
    RAISE EXCEPTION 'Academia não encontrada para o usuário';
  END IF;

  -- Somente membros da própria academia (via get_my_academy_id).
  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.slug,
    a.city,
    a.state,
    a.address
  FROM public.academies a
  WHERE a.id = v_academy_id;
END;
$$;

COMMENT ON FUNCTION public.get_my_academy_basic_info() IS
  'Retorna apenas id/name/slug/city/state/address da academia do usuário autenticado.';

REVOKE ALL ON FUNCTION public.get_my_academy_basic_info() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_academy_basic_info() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_academy_basic_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_academy_basic_info() TO service_role;

-- Leitura de alunos para ranking/graduação/presenças (sem insert/update/delete)
DROP POLICY IF EXISTS "st_select_academy_limited" ON public.students;
CREATE POLICY "st_select_academy_limited"
  ON public.students FOR SELECT TO authenticated
  USING (public.is_academy_limited_of(academy_id));

-- Presenças / sessões: operação limitada (sem financeiro)
DROP POLICY IF EXISTS "att_manage_academy_limited" ON public.attendances;
CREATE POLICY "att_manage_academy_limited"
  ON public.attendances FOR ALL TO authenticated
  USING (public.is_academy_limited_of(academy_id))
  WITH CHECK (public.is_academy_limited_of(academy_id));

DROP POLICY IF EXISTS "as_manage_academy_limited" ON public.attendance_sessions;
CREATE POLICY "as_manage_academy_limited"
  ON public.attendance_sessions FOR ALL TO authenticated
  USING (public.is_academy_limited_of(academy_id))
  WITH CHECK (public.is_academy_limited_of(academy_id));

DO $$
DECLARE
  v_academy_id UUID;
  v_herbert_count INTEGER := 0;
  v_lanes_count INTEGER := 0;
  v_limited_user_id UUID;
  v_limited_name TEXT;
  v_limited_matches INTEGER := 0;
  v_address TEXT := 'Avenida Mariza de souza Mendes, 71a';
BEGIN
  SELECT id INTO v_academy_id
  FROM public.academies
  WHERE slug = 'faith-brothers'
  LIMIT 1;

  IF v_academy_id IS NULL THEN
    RAISE EXCEPTION 'Academia faith-brothers não encontrada. Migration abortada.';
  END IF;

  UPDATE public.academies
  SET address = v_address,
      updated_at = now()
  WHERE id = v_academy_id
    AND address IS DISTINCT FROM v_address;

  RAISE NOTICE 'Endereço da academia atualizado para: %', v_address;

  -- Herbert: remove TODOS os papéis (exclusão lógica — NÃO apaga profiles/auth/histórico)
  WITH targets AS (
    SELECT DISTINCT p.user_id
    FROM public.profiles p
    WHERE p.academy_id = v_academy_id
      AND (
        p.full_name ILIKE '%Herbert%'
        OR regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g') IN ('31998565661', '5531998565661')
      )
      -- trava: nunca afetar WhatsApp da academia / Ramon / André / Warlen
      AND regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g') NOT IN (
        '31985010010', '5531985010010',
        '31987540515', '5531987540515',
        '31981044156', '5531981044156',
        '31997586456', '5531997586456'
      )
  ),
  deleted AS (
    DELETE FROM public.user_roles ur
    USING targets t
    WHERE ur.user_id = t.user_id
    RETURNING ur.user_id
  )
  SELECT COUNT(DISTINCT user_id) INTO v_herbert_count FROM deleted;

  IF v_herbert_count = 0 THEN
    RAISE NOTICE 'AVISO: nenhum perfil Herbert encontrado para desativar.';
  ELSE
    RAISE NOTICE 'Herbert desativado (roles removidas; perfil/histórico preservados): % usuário(s).', v_herbert_count;
  END IF;

  -- Lanes / José Lanes / Jose Lanes: exclusão lógica (só user_roles)
  WITH targets AS (
    SELECT DISTINCT p.user_id
    FROM public.profiles p
    WHERE p.academy_id = v_academy_id
      AND (
        p.full_name ILIKE '%Lanes%'
        OR p.full_name ILIKE '%José Lanes%'
        OR p.full_name ILIKE '%Jose Lanes%'
        OR regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g') IN ('31987438874', '5531987438874')
      )
      AND regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g') NOT IN (
        '31985010010', '5531985010010',
        '31987540515', '5531987540515',
        '31981044156', '5531981044156',
        '31997586456', '5531997586456'
      )
  ),
  deleted AS (
    DELETE FROM public.user_roles ur
    USING targets t
    WHERE ur.user_id = t.user_id
    RETURNING ur.user_id
  )
  SELECT COUNT(DISTINCT user_id) INTO v_lanes_count FROM deleted;

  IF v_lanes_count = 0 THEN
    RAISE NOTICE 'AVISO: nenhum perfil Lanes/José Lanes encontrado para desativar.';
  ELSE
    RAISE NOTICE 'Lanes desativado (roles removidas; perfil/histórico preservados): % usuário(s).', v_lanes_count;
  END IF;

  -- WhatsApp da academia: deve existir EXATAMENTE 1 usuário (falha caso contrário)
  WITH matches AS (
    SELECT DISTINCT p.user_id, p.full_name
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.user_id
    WHERE p.academy_id = v_academy_id
      AND (
        regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g') IN (
          '31985010010',
          '5531985010010'
        )
        OR lower(COALESCE(u.email, '')) IN (
          '31985010010@wa.faithbrothers.app',
          '5531985010010@wa.faithbrothers.app'
        )
      )
  )
  SELECT COUNT(*) INTO v_limited_matches FROM matches;

  IF v_limited_matches = 0 THEN
    RAISE EXCEPTION
      'WhatsApp da academia 31985010010 / 5531985010010 não encontrado. Migration abortada para evitar deixar acesso admin sem limitação.';
  END IF;

  IF v_limited_matches > 1 THEN
    RAISE EXCEPTION
      'WhatsApp da academia 31985010010 / 5531985010010 corresponde a % usuários. Migration abortada para evitar limitar a pessoa errada.',
      v_limited_matches;
  END IF;

  SELECT m.user_id, m.full_name
  INTO v_limited_user_id, v_limited_name
  FROM (
    SELECT DISTINCT p.user_id, p.full_name
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.user_id
    WHERE p.academy_id = v_academy_id
      AND (
        regexp_replace(COALESCE(p.whatsapp, ''), '\D', '', 'g') IN (
          '31985010010',
          '5531985010010'
        )
        OR lower(COALESCE(u.email, '')) IN (
          '31985010010@wa.faithbrothers.app',
          '5531985010010@wa.faithbrothers.app'
        )
      )
  ) m
  LIMIT 1;

  DELETE FROM public.user_roles
  WHERE user_id = v_limited_user_id
    AND role IN (
      'admin'::public.app_role,
      'professor'::public.app_role,
      'aluno'::public.app_role,
      'academy_limited'::public.app_role
    );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_limited_user_id, 'academy_limited'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE 'WhatsApp da academia limitado: user_id=%, nome=%, role=academy_limited',
    v_limited_user_id, COALESCE(v_limited_name, '(sem nome)');
END $$;
