CREATE SCHEMA IF NOT EXISTS internal;

-- pgcrypto lives in the extensions schema on Supabase; gen_random_bytes is not in core PG
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS internal.app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO internal.app_secrets (key, value)
VALUES ('billing_cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_billing_cron_secret()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, internal
AS $$
  SELECT value
  FROM internal.app_secrets
  WHERE key = 'billing_cron_secret'
  LIMIT 1
$$;

REVOKE ALL ON SCHEMA internal FROM PUBLIC;
REVOKE ALL ON TABLE internal.app_secrets FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_billing_cron_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_billing_cron_secret() FROM anon;
REVOKE ALL ON FUNCTION public.get_billing_cron_secret() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_cron_secret() TO service_role;