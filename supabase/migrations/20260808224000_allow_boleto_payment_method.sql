-- Allow boleto as registration payment intent (Asaas monthly path).
-- Card/machine methods unchanged. Additive constraint refresh.

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_requested_payment_method_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_requested_payment_method_check
  CHECK (
    requested_payment_method IS NULL
    OR requested_payment_method = ANY (ARRAY[
      'boleto'::text,
      'cartao_credito'::text,
      'cartao_debito'::text,
      'pix'::text,
      'dinheiro'::text
    ])
  );
