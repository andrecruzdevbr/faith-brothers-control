CREATE OR REPLACE FUNCTION public.matches_billing_cron_secret(_secret TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, internal
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM internal.app_secrets
    WHERE key = 'billing_cron_secret'
      AND value = _secret
  )
$$;

REVOKE ALL ON FUNCTION public.matches_billing_cron_secret(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matches_billing_cron_secret(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.matches_billing_cron_secret(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.matches_billing_cron_secret(TEXT) TO service_role;