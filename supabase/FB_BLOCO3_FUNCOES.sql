-- ================================================================
-- FAITH BROTHERS — BLOCO 3: FUNÇÕES HELPER
-- Pré-requisito: BLOCO 2 executado
-- CREATE OR REPLACE — seguro reexecutar
-- ================================================================

-- get_my_academy_id: retorna a academia do usuário logado
CREATE OR REPLACE FUNCTION public.get_my_academy_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT academy_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- has_role: verifica se um user_id tem determinado role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- is_admin_of_academy: true para admin OU professor da academia
-- CORRIGE O BUG HISTÓRICO: migration 20260320 excluía professor
CREATE OR REPLACE FUNCTION public.is_admin_of_academy(_academy_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id    = auth.uid()
      AND p.academy_id = _academy_id
      AND ur.role      IN ('admin', 'professor')
  )
$$;

-- can_access_student: true se é o próprio aluno ou admin/professor
CREATE OR REPLACE FUNCTION public.can_access_student(_student_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = _student_id
      AND (
        s.profile_user_id = auth.uid()
        OR public.is_admin_of_academy(s.academy_id)
      )
  )
$$;

-- can_access_billing: true se é o aluno da cobrança ou admin/professor
CREATE OR REPLACE FUNCTION public.can_access_billing(_billing_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.billings b
    JOIN public.students s ON s.id = b.student_id
    WHERE b.id = _billing_id
      AND (
        s.profile_user_id = auth.uid()
        OR public.is_admin_of_academy(b.academy_id)
      )
  )
$$;

-- get_billing_cron_secret: usado pelas edge functions
CREATE OR REPLACE FUNCTION public.get_billing_cron_secret()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, internal AS $$
  SELECT value FROM internal.app_secrets WHERE key = 'billing_cron_secret' LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.matches_billing_cron_secret(_secret text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, internal AS $$
  SELECT EXISTS (
    SELECT 1 FROM internal.app_secrets
    WHERE key = 'billing_cron_secret' AND value = _secret
  )
$$;

-- cleanup_expired_otps
CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.otp_tokens WHERE expires_at < now() - INTERVAL '1 hour';
$$;

-- auto_assign_role_by_phone REMOVIDO (segurança — papéis via manage_staff_member)

DROP TRIGGER IF EXISTS trg_auto_assign_role ON public.profiles;
DROP TRIGGER IF EXISTS trg_auto_assign_role_by_phone ON public.profiles;
DROP FUNCTION IF EXISTS public.auto_assign_role_by_phone();

-- is_admin_only: apenas admin (não professor)
CREATE OR REPLACE FUNCTION public.is_admin_only(_academy_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE p.user_id = auth.uid() AND p.academy_id = _academy_id AND ur.role = 'admin'
  )
$$;

-- Grants
REVOKE ALL ON FUNCTION public.get_billing_cron_secret()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.matches_billing_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_cron_secret()         TO service_role;
GRANT EXECUTE ON FUNCTION public.matches_billing_cron_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_academy_id()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_of_academy(UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_student(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_billing(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_only(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_otps()            TO service_role;

-- Verificação: deve listar as funções criadas
SELECT proname, prosecdef AS security_definer
FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND proname IN (
    'get_my_academy_id','has_role','is_admin_of_academy','is_admin_only',
    'can_access_student','can_access_billing',
    'cleanup_expired_otps','get_billing_cron_secret','matches_billing_cron_secret'
  )
ORDER BY proname;
