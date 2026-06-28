-- ================================================================
-- FAITH BROTHERS — BLOCO 2: TABELAS (corrigido)
-- Pré-requisito: BLOCO 1 executado E COMITADO
-- CORREÇÃO APLICADA: guarda de dependência + casts explícitos de enum
-- ================================================================

-- GUARDA: falha alto e claro se o Bloco 1 não rodou completo
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'student_status' AND e.enumlabel = 'pendente_aprovacao'
  ) THEN
    RAISE EXCEPTION 'BLOCO 1 não foi executado completamente (student_status sem pendente_aprovacao). Execute o BLOCO 1 primeiro.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'professor'
  ) THEN
    RAISE EXCEPTION 'BLOCO 1 não foi executado completamente (app_role sem professor). Execute o BLOCO 1 primeiro.';
  END IF;
END $$;

-- Função updated_at (necessária antes dos triggers)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. academies (tenant raiz)
CREATE TABLE IF NOT EXISTS public.academies (
  id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name                 TEXT        NOT NULL,
  slug                 TEXT        NOT NULL UNIQUE,
  city                 TEXT,
  state                TEXT,
  address              TEXT,
  finance_contact_name TEXT        NOT NULL DEFAULT '',
  finance_whatsapp     TEXT        NOT NULL DEFAULT '',
  bank_name            TEXT        NOT NULL DEFAULT '',
  bank_code            TEXT        NOT NULL DEFAULT '',
  bank_branch          TEXT        NOT NULL DEFAULT '',
  bank_account         TEXT        NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. profiles (vincula auth.users à academia)
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id    UUID        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  academy_id UUID        NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  full_name  TEXT        NOT NULL,
  whatsapp   TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         UUID            NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 4. academy_billing_settings
CREATE TABLE IF NOT EXISTS public.academy_billing_settings (
  id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id                  UUID        NOT NULL UNIQUE REFERENCES public.academies(id) ON DELETE CASCADE,
  boleto_issue_day            INTEGER     NOT NULL DEFAULT 12 CHECK (boleto_issue_day BETWEEN 1 AND 28),
  boleto_due_day              INTEGER     NOT NULL DEFAULT 16 CHECK (boleto_due_day BETWEEN 1 AND 28),
  payment_provider            TEXT        NOT NULL DEFAULT 'asaas',
  whatsapp_provider           TEXT        NOT NULL DEFAULT 'evolution',
  send_whatsapp_automatically BOOLEAN     NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. plans
CREATE TABLE IF NOT EXISTS public.plans (
  id                     UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id             UUID          NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  name                   TEXT          NOT NULL,
  monthly_price          NUMERIC(10,2) NOT NULL CHECK (monthly_price >= 0),
  training_days_per_week INTEGER,
  active                 BOOLEAN       NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (academy_id, name)
);

-- 6. students (cast explícito do default, não depende de inferência)
CREATE TABLE IF NOT EXISTS public.students (
  id                UUID                  NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id        UUID                  NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  profile_user_id   UUID                  UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_id           UUID                  REFERENCES public.plans(id) ON DELETE SET NULL,
  full_name         TEXT                  NOT NULL,
  email             TEXT,
  whatsapp          TEXT                  NOT NULL DEFAULT '',
  birth_date        DATE,
  belt              TEXT,
  degrees           INTEGER               NOT NULL DEFAULT 0 CHECK (degrees >= 0),
  start_date        DATE,
  emergency_contact TEXT,
  photo_url         TEXT,
  status            public.student_status NOT NULL DEFAULT 'pendente_aprovacao'::public.student_status,
  asaas_customer_id TEXT,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ           NOT NULL DEFAULT now()
);

-- 7. billings
CREATE TABLE IF NOT EXISTS public.billings (
  id               UUID                  NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id       UUID                  NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  student_id       UUID                  NOT NULL REFERENCES public.students(id)  ON DELETE CASCADE,
  plan_id          UUID                  REFERENCES public.plans(id) ON DELETE SET NULL,
  reference_month  DATE                  NOT NULL,
  amount           NUMERIC(10,2)         NOT NULL CHECK (amount >= 0),
  issue_date       DATE                  NOT NULL,
  due_date         DATE                  NOT NULL,
  status           public.billing_status NOT NULL DEFAULT 'pendente'::public.billing_status,
  asaas_payment_id TEXT                  UNIQUE,
  boleto_url       TEXT,
  invoice_number   TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ           NOT NULL DEFAULT now(),
  UNIQUE (student_id, reference_month)
);

-- 8. attendance_sessions
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id        UUID        NOT NULL REFERENCES public.academies(id),
  professor_user_id UUID        NOT NULL,
  token             TEXT        NOT NULL UNIQUE,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. attendances
CREATE TABLE IF NOT EXISTS public.attendances (
  id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id    UUID        NOT NULL REFERENCES public.attendance_sessions(id),
  student_id    UUID        NOT NULL REFERENCES public.students(id),
  academy_id    UUID        NOT NULL REFERENCES public.academies(id),
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);

-- 10. otp_tokens
CREATE TABLE IF NOT EXISTS public.otp_tokens (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp   TEXT        NOT NULL,
  code       TEXT        NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT false,
  attempts   INTEGER     NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_profiles_academy_id        ON public.profiles(academy_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id          ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_academy_id            ON public.plans(academy_id);
CREATE INDEX IF NOT EXISTS idx_students_academy_id         ON public.students(academy_id);
CREATE INDEX IF NOT EXISTS idx_students_profile_user_id    ON public.students(profile_user_id);
CREATE INDEX IF NOT EXISTS idx_billings_student_id         ON public.billings(student_id);
CREATE INDEX IF NOT EXISTS idx_billings_status             ON public.billings(status);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_academy ON public.attendance_sessions(academy_id);
CREATE INDEX IF NOT EXISTS idx_attendances_session_id      ON public.attendances(session_id);
CREATE INDEX IF NOT EXISTS idx_attendances_student_id      ON public.attendances(student_id);
CREATE INDEX IF NOT EXISTS idx_otp_tokens_whatsapp         ON public.otp_tokens(whatsapp);
CREATE INDEX IF NOT EXISTS idx_otp_tokens_expires_at       ON public.otp_tokens(expires_at);

-- Triggers updated_at (idempotente via DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upd_academies') THEN
    CREATE TRIGGER trg_upd_academies  BEFORE UPDATE ON public.academies               FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upd_profiles') THEN
    CREATE TRIGGER trg_upd_profiles   BEFORE UPDATE ON public.profiles                FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upd_billing_cfg') THEN
    CREATE TRIGGER trg_upd_billing_cfg BEFORE UPDATE ON public.academy_billing_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upd_plans') THEN
    CREATE TRIGGER trg_upd_plans      BEFORE UPDATE ON public.plans                   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upd_students') THEN
    CREATE TRIGGER trg_upd_students   BEFORE UPDATE ON public.students                FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_upd_billings') THEN
    CREATE TRIGGER trg_upd_billings   BEFORE UPDATE ON public.billings                FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Realtime para attendances
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.attendances;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- já adicionado, ignorar
END $$;

-- Verificação: deve retornar 10 linhas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'academies','profiles','user_roles','academy_billing_settings',
    'plans','students','billings','attendance_sessions','attendances','otp_tokens'
  )
ORDER BY table_name;
