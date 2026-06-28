-- Core enums
CREATE TYPE public.app_role AS ENUM ('admin', 'aluno');
CREATE TYPE public.student_status AS ENUM ('ativo', 'inativo');
CREATE TYPE public.billing_status AS ENUM ('pendente', 'gerado', 'enviado_whatsapp', 'pago', 'vencido', 'cancelado', 'falhou');

-- Updated-at trigger helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Tenant table
CREATE TABLE public.academies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  city TEXT,
  state TEXT,
  address TEXT,
  finance_contact_name TEXT NOT NULL DEFAULT 'Felipe Nogueira',
  finance_whatsapp TEXT NOT NULL DEFAULT '+55 31 99308-2330',
  bank_name TEXT NOT NULL DEFAULT 'Nubank',
  bank_code TEXT NOT NULL DEFAULT '0260',
  bank_branch TEXT NOT NULL DEFAULT '0001',
  bank_account TEXT NOT NULL DEFAULT '8496054-5',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auth-linked profiles
CREATE TABLE public.profiles (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  whatsapp TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles MUST be in a separate table
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Academy billing configuration
CREATE TABLE public.academy_billing_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id UUID NOT NULL UNIQUE REFERENCES public.academies(id) ON DELETE CASCADE,
  boleto_issue_day INTEGER NOT NULL DEFAULT 12 CHECK (boleto_issue_day BETWEEN 1 AND 28),
  boleto_due_day INTEGER NOT NULL DEFAULT 16 CHECK (boleto_due_day BETWEEN 1 AND 28),
  payment_provider TEXT NOT NULL DEFAULT 'asaas',
  whatsapp_provider TEXT NOT NULL DEFAULT 'evolution',
  send_whatsapp_automatically BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plans per academy
CREATE TABLE public.plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  monthly_price NUMERIC(10,2) NOT NULL CHECK (monthly_price >= 0),
  training_days_per_week INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (academy_id, name)
);

-- Students managed by academy, optionally linked to an auth user
CREATE TABLE public.students (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  profile_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  whatsapp TEXT NOT NULL,
  birth_date DATE,
  belt TEXT,
  degrees INTEGER NOT NULL DEFAULT 0 CHECK (degrees >= 0),
  start_date DATE,
  emergency_contact TEXT,
  photo_url TEXT,
  status public.student_status NOT NULL DEFAULT 'ativo',
  asaas_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Monthly billings / boletos
CREATE TABLE public.billings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  academy_id UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  reference_month DATE NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status public.billing_status NOT NULL DEFAULT 'pendente',
  asaas_payment_id TEXT UNIQUE,
  boleto_url TEXT,
  invoice_number TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, reference_month)
);

-- Helpful indexes
CREATE INDEX idx_profiles_academy_id ON public.profiles(academy_id);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_plans_academy_id ON public.plans(academy_id);
CREATE INDEX idx_students_academy_id ON public.students(academy_id);
CREATE INDEX idx_students_profile_user_id ON public.students(profile_user_id);
CREATE INDEX idx_billings_academy_id ON public.billings(academy_id);
CREATE INDEX idx_billings_student_id ON public.billings(student_id);
CREATE INDEX idx_billings_reference_month ON public.billings(reference_month);
CREATE INDEX idx_billings_status ON public.billings(status);

-- Helper functions for RLS
CREATE OR REPLACE FUNCTION public.get_my_academy_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT academy_id
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_of_academy(_academy_id UUID)
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
      AND public.has_role(auth.uid(), 'admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = _student_id
      AND (
        s.profile_user_id = auth.uid()
        OR public.is_admin_of_academy(s.academy_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_billing(_billing_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

-- Enable RLS
ALTER TABLE public.academies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;

-- Academies policies
CREATE POLICY "Users can view own academy"
ON public.academies
FOR SELECT
TO authenticated
USING (id = public.get_my_academy_id());

CREATE POLICY "Admins can update own academy"
ON public.academies
FOR UPDATE
TO authenticated
USING (public.is_admin_of_academy(id))
WITH CHECK (public.is_admin_of_academy(id));

-- Profiles policies
CREATE POLICY "Users can view own profile or admins can view academy profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR (
    academy_id = public.get_my_academy_id()
    AND public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "Users can insert own profile or admins can insert academy profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR public.is_admin_of_academy(academy_id)
);

CREATE POLICY "Users can update own profile or admins can update academy profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin_of_academy(academy_id)
)
WITH CHECK (
  user_id = auth.uid()
  OR public.is_admin_of_academy(academy_id)
);

-- User roles policies
CREATE POLICY "Users can view own roles or admins can view academy roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = public.user_roles.user_id
      AND public.is_admin_of_academy(p.academy_id)
  )
);

CREATE POLICY "Admins can manage roles in their academy"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = public.user_roles.user_id
      AND public.is_admin_of_academy(p.academy_id)
  )
);

CREATE POLICY "Admins can update roles in their academy"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = public.user_roles.user_id
      AND public.is_admin_of_academy(p.academy_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = public.user_roles.user_id
      AND public.is_admin_of_academy(p.academy_id)
  )
);

CREATE POLICY "Admins can delete roles in their academy"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = public.user_roles.user_id
      AND public.is_admin_of_academy(p.academy_id)
  )
);

-- Billing settings policies
CREATE POLICY "Users can view academy billing settings"
ON public.academy_billing_settings
FOR SELECT
TO authenticated
USING (academy_id = public.get_my_academy_id());

CREATE POLICY "Admins can manage academy billing settings"
ON public.academy_billing_settings
FOR ALL
TO authenticated
USING (public.is_admin_of_academy(academy_id))
WITH CHECK (public.is_admin_of_academy(academy_id));

-- Plans policies
CREATE POLICY "Users can view plans from own academy"
ON public.plans
FOR SELECT
TO authenticated
USING (academy_id = public.get_my_academy_id());

CREATE POLICY "Admins can manage plans from own academy"
ON public.plans
FOR ALL
TO authenticated
USING (public.is_admin_of_academy(academy_id))
WITH CHECK (public.is_admin_of_academy(academy_id));

-- Students policies
CREATE POLICY "Admins can view academy students and students can view themselves"
ON public.students
FOR SELECT
TO authenticated
USING (public.can_access_student(id));

CREATE POLICY "Admins can insert students in own academy"
ON public.students
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin_of_academy(academy_id));

CREATE POLICY "Admins can update academy students"
ON public.students
FOR UPDATE
TO authenticated
USING (public.is_admin_of_academy(academy_id))
WITH CHECK (public.is_admin_of_academy(academy_id));

CREATE POLICY "Admins can delete academy students"
ON public.students
FOR DELETE
TO authenticated
USING (public.is_admin_of_academy(academy_id));

-- Billings policies
CREATE POLICY "Admins can view academy billings and students can view own billings"
ON public.billings
FOR SELECT
TO authenticated
USING (public.can_access_billing(id));

CREATE POLICY "Admins can manage academy billings"
ON public.billings
FOR ALL
TO authenticated
USING (public.is_admin_of_academy(academy_id))
WITH CHECK (public.is_admin_of_academy(academy_id));

-- Updated-at triggers
CREATE TRIGGER update_academies_updated_at
BEFORE UPDATE ON public.academies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_academy_billing_settings_updated_at
BEFORE UPDATE ON public.academy_billing_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_plans_updated_at
BEFORE UPDATE ON public.plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_students_updated_at
BEFORE UPDATE ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_billings_updated_at
BEFORE UPDATE ON public.billings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Read model for student financial area
CREATE VIEW public.student_financial_overview AS
SELECT
  s.id AS student_id,
  s.academy_id,
  s.full_name,
  p.name AS plan_name,
  p.monthly_price,
  b.id AS billing_id,
  b.reference_month,
  b.amount,
  b.issue_date,
  b.due_date,
  b.status,
  b.boleto_url,
  b.whatsapp_sent_at,
  b.paid_at
FROM public.students s
LEFT JOIN public.plans p ON p.id = s.plan_id
LEFT JOIN LATERAL (
  SELECT b1.*
  FROM public.billings b1
  WHERE b1.student_id = s.id
  ORDER BY b1.reference_month DESC, b1.created_at DESC
  LIMIT 1
) b ON true;