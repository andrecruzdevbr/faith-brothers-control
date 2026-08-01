-- ================================================================
-- FAITH BROTHERS — BLOCO 6: SEED DESENVOLVIMENTO
-- Executar apenas em ambiente de DEV via SQL Editor
-- Senha padrão: faithbrothers2026
-- ================================================================

INSERT INTO public.academies (id, name, slug, city, state, address, finance_contact_name, finance_whatsapp, bank_name, bank_code, bank_branch, bank_account)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Faith Brothers BJJ', 'faith-brothers', 'Ouro Branco', 'MG',
  'Avenida Mariza de souza Mendes, 71a', 'Ramon Pereira de São José', '31987540515',
  'Banco do Brasil', '001', '2372-8', '42762-4'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, city = EXCLUDED.city, state = EXCLUDED.state,
  address = EXCLUDED.address, finance_contact_name = EXCLUDED.finance_contact_name,
  finance_whatsapp = EXCLUDED.finance_whatsapp,
  bank_name = EXCLUDED.bank_name, bank_code = EXCLUDED.bank_code,
  bank_branch = EXCLUDED.bank_branch, bank_account = EXCLUDED.bank_account;

INSERT INTO public.academy_billing_settings (academy_id, boleto_issue_day, boleto_due_day, send_whatsapp_automatically)
VALUES ('00000000-0000-0000-0000-000000000001', 10, 15, true)
ON CONFLICT (academy_id) DO UPDATE SET
  boleto_issue_day = EXCLUDED.boleto_issue_day,
  boleto_due_day = EXCLUDED.boleto_due_day,
  send_whatsapp_automatically = EXCLUDED.send_whatsapp_automatically;

INSERT INTO public.plans (academy_id, name, monthly_price, training_days_per_week, active)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Plano Básico (2x)', 150.00, 2, true),
  ('00000000-0000-0000-0000-000000000001', 'Plano Intermediário (3x)', 200.00, 3, true),
  ('00000000-0000-0000-0000-000000000001', 'Plano Completo (5x)', 250.00, 5, true)
ON CONFLICT (academy_id, name) DO NOTHING;

-- Helper: cria usuário auth + profile + roles
CREATE OR REPLACE FUNCTION internal._dev_seed_user(
  _whatsapp TEXT,
  _name TEXT,
  _password TEXT,
  _roles public.app_role[],
  _academy UUID DEFAULT '00000000-0000-0000-0000-000000000001'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  _uid UUID;
  _email TEXT := _whatsapp || '@wa.faithbrothers.app';
  _role public.app_role;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE email = _email;
  IF _uid IS NULL THEN
    _uid := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      _uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      _email, crypt(_password, gen_salt('bf')), now(),
      jsonb_build_object('full_name', _name, 'whatsapp', _whatsapp), now(), now(), '', '', '', ''
    );
  ELSE
    UPDATE auth.users SET encrypted_password = crypt(_password, gen_salt('bf')), updated_at = now() WHERE id = _uid;
  END IF;

  INSERT INTO public.profiles (user_id, academy_id, full_name, whatsapp)
  VALUES (_uid, _academy, _name, _whatsapp)
  ON CONFLICT (user_id) DO UPDATE SET full_name = _name, whatsapp = _whatsapp, updated_at = now();

  DELETE FROM public.user_roles WHERE user_id = _uid;
  FOREACH _role IN ARRAY _roles LOOP
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role);
  END LOOP;

  IF _roles @> ARRAY['admin'::public.app_role] OR _roles @> ARRAY['professor'::public.app_role] THEN
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'aluno';
  END IF;
END;
$$;

SELECT internal._dev_seed_user('31987540515', 'Ramon', 'faithbrothers2026', ARRAY['admin','professor']::public.app_role[]);
-- Herbert e Lanes: desativados em produção (migration 20260731200100). Não recriar com admin.
-- SELECT internal._dev_seed_user('31998565661', 'Herbert', 'faithbrothers2026', ARRAY['admin','professor']::public.app_role[]);
SELECT internal._dev_seed_user('31997586456', 'Warlen', 'faithbrothers2026', ARRAY['admin','professor']::public.app_role[]);
SELECT internal._dev_seed_user('31981044156', 'André', 'faithbrothers2026', ARRAY['admin','professor']::public.app_role[]);
-- SELECT internal._dev_seed_user('31987438874', 'Lanes', 'faithbrothers2026', ARRAY['admin','professor']::public.app_role[]);
-- WhatsApp da academia (acesso limitado)
SELECT internal._dev_seed_user('31985010010', 'Academia Faith Brothers', 'faithbrothers2026', ARRAY['academy_limited']::public.app_role[]);

-- Aluno teste
SELECT internal._dev_seed_user('31999999999', 'Aluno Teste', '123456', ARRAY['aluno']::public.app_role[]);

DO $$
DECLARE _uid UUID;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE email = '31999999999@wa.faithbrothers.app';
  INSERT INTO public.students (academy_id, profile_user_id, full_name, whatsapp, belt, degrees, status, plan_id)
  SELECT '00000000-0000-0000-0000-000000000001', _uid, 'Aluno Teste', '31999999999', 'Branca', 0, 'ativo'::public.student_status,
         (SELECT id FROM public.plans WHERE academy_id = '00000000-0000-0000-0000-000000000001' AND name = 'Plano Completo (5x)' LIMIT 1)
  ON CONFLICT (profile_user_id) DO UPDATE SET status = 'ativo'::public.student_status, updated_at = now();
END $$;

DROP FUNCTION IF EXISTS internal._dev_seed_user(TEXT, TEXT, TEXT, public.app_role[], UUID);

SELECT u.email, p.full_name, array_agg(ur.role::text) AS roles
FROM auth.users u
JOIN public.profiles p ON p.user_id = u.id
JOIN public.user_roles ur ON ur.user_id = u.id
WHERE u.email LIKE '%@wa.faithbrothers.app'
GROUP BY u.email, p.full_name
ORDER BY p.full_name;
