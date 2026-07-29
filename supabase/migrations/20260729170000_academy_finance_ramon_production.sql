-- Dados financeiros da academia: responsável Ramon (conta PJ) + CNPJ mascarado para exibição.
-- API Key do Asaas NÃO entra nesta migration (somente Supabase Secrets).

ALTER TABLE public.academies
  ADD COLUMN IF NOT EXISTS finance_document_display TEXT;

ALTER TABLE public.academies
  ADD COLUMN IF NOT EXISTS asaas_environment_label TEXT NOT NULL DEFAULT 'production';

COMMENT ON COLUMN public.academies.finance_document_display IS
  'CNPJ/MEI parcial para exibição administrativa (nunca armazenar documento completo se não necessário).';

COMMENT ON COLUMN public.academies.asaas_environment_label IS
  'Indicador seguro de ambiente Asaas esperado: production | sandbox. A chave real fica só em Secrets.';

-- Faith Brothers (slug) e qualquer registro ainda com Felipe
UPDATE public.academies
SET
  finance_contact_name = 'Ramon Pereira de São José',
  finance_whatsapp = '31987540515',
  bank_name = 'Nubank / Nu PJ',
  bank_code = '260',
  bank_branch = '2372-8',
  bank_account = '42762-4',
  finance_document_display = '53.536.865/0001-XX',
  asaas_environment_label = 'production',
  updated_at = now()
WHERE slug = 'faith-brothers'
   OR finance_contact_name ILIKE '%Felipe%';

-- Garante vencimento dia 15 e WhatsApp automático (já regra da academia)
UPDATE public.academy_billing_settings abs
SET
  boleto_issue_day = 1,
  boleto_due_day = 15,
  send_whatsapp_automatically = TRUE,
  updated_at = now()
FROM public.academies a
WHERE abs.academy_id = a.id
  AND (
    a.slug = 'faith-brothers'
    OR a.finance_contact_name = 'Ramon Pereira de São José'
  );
