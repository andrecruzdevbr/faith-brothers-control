-- Additive: WhatsApp idempotency key for contract approval messages
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_idempotency_key
  ON public.whatsapp_messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_messages.idempotency_key IS
  'Chave estável: ex. contract_approved:{contract_id}:{event}. Impede reenvio.';
