-- Official monthly boleto: issue on day 12, due on day 15.
-- Does not touch Production until this migration is applied by later authorization.

ALTER TABLE public.academy_billing_settings
  ALTER COLUMN boleto_issue_day SET DEFAULT 12;

ALTER TABLE public.academy_billing_settings
  ALTER COLUMN boleto_due_day SET DEFAULT 15;

UPDATE public.academy_billing_settings
SET
  boleto_issue_day = 12,
  boleto_due_day = 15,
  updated_at = now()
WHERE boleto_issue_day IS DISTINCT FROM 12
   OR boleto_due_day IS DISTINCT FROM 15;
