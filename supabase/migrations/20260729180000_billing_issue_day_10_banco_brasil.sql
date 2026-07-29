-- Banco do Brasil (repasse manual no painel Asaas) + emissão de cobranças no dia 10.
-- API Key / webhook NÃO entram nesta migration.

UPDATE public.academies
SET
  finance_contact_name = 'Ramon Pereira de São José',
  finance_whatsapp = '31987540515',
  bank_name = 'Banco do Brasil',
  bank_code = '001',
  bank_branch = '2372-8',
  bank_account = '42762-4',
  finance_document_display = '53.536.865/0001-XX',
  asaas_environment_label = 'production',
  updated_at = now()
WHERE slug = 'faith-brothers'
   OR finance_contact_name ILIKE '%Ramon%'
   OR finance_contact_name ILIKE '%Felipe%';

UPDATE public.academy_billing_settings abs
SET
  boleto_issue_day = 10,
  boleto_due_day = 15,
  send_whatsapp_automatically = TRUE,
  updated_at = now()
FROM public.academies a
WHERE abs.academy_id = a.id
  AND (
    a.slug = 'faith-brothers'
    OR a.finance_contact_name = 'Ramon Pereira de São José'
  );

ALTER TABLE public.academy_billing_settings
  ALTER COLUMN boleto_issue_day SET DEFAULT 10;

ALTER TABLE public.academy_billing_settings
  ALTER COLUMN boleto_due_day SET DEFAULT 15;
