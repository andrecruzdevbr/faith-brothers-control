-- Padrão financeiro da academia: emissão dia 1, vencimento dia 15, WhatsApp automático

ALTER TABLE public.academy_billing_settings
  ALTER COLUMN boleto_issue_day SET DEFAULT 1;

ALTER TABLE public.academy_billing_settings
  ALTER COLUMN boleto_due_day SET DEFAULT 15;

ALTER TABLE public.academy_billing_settings
  ALTER COLUMN send_whatsapp_automatically SET DEFAULT TRUE;

-- Garante linha de settings para cada academia
INSERT INTO public.academy_billing_settings (
  academy_id,
  boleto_issue_day,
  boleto_due_day,
  send_whatsapp_automatically
)
SELECT a.id, 1, 15, TRUE
FROM public.academies a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.academy_billing_settings s
  WHERE s.academy_id = a.id
);

-- Atualiza academias existentes para a regra oficial
UPDATE public.academy_billing_settings
SET
  boleto_issue_day = 1,
  boleto_due_day = 15,
  send_whatsapp_automatically = TRUE,
  updated_at = now();
