-- ================================================================
-- FAITH BROTHERS — BLOCO 1: ENUMS
-- Pré-requisito: nenhum
-- Pode executar múltiplas vezes sem erro
-- ================================================================

-- app_role: já existe com ('admin','aluno') — adicionar 'professor' se faltar
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'professor'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'professor';
  END IF;
END $$;

-- student_status: criar completo se não existir
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'student_status') THEN
    CREATE TYPE public.student_status AS ENUM (
      'ativo', 'inativo', 'pendente_aprovacao', 'rejeitado'
    );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'student_status' AND e.enumlabel = 'pendente_aprovacao') THEN
    ALTER TYPE public.student_status ADD VALUE 'pendente_aprovacao';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'student_status' AND e.enumlabel = 'rejeitado') THEN
    ALTER TYPE public.student_status ADD VALUE 'rejeitado';
  END IF;
END $$;

-- billing_status: criar se não existir
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_status') THEN
    CREATE TYPE public.billing_status AS ENUM (
      'pendente', 'gerado', 'enviado_whatsapp', 'pago', 'vencido', 'cancelado', 'falhou'
    );
  END IF;
END $$;

-- schema internal para secrets (sem pg_cron/pg_net que falham no free tier)
CREATE SCHEMA IF NOT EXISTS internal;

-- pgcrypto: gen_random_bytes lives in extensions schema on Supabase
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS internal.app_secrets (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO internal.app_secrets (key, value)
VALUES ('billing_cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

REVOKE ALL ON SCHEMA internal              FROM PUBLIC;
REVOKE ALL ON TABLE  internal.app_secrets  FROM PUBLIC;

-- Verificação
SELECT
  t.typname,
  string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS valores
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
GROUP BY t.typname
ORDER BY t.typname;
