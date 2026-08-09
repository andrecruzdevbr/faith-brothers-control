-- Harden RPC grants: payment confirmation / veteran period / registration atomic
-- must not be callable by anon. Auth checks remain inside functions.

REVOKE ALL ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_veteran_billing_period(UUID, TEXT, TEXT, INTEGER)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_individual_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.confirm_individual_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, NUMERIC, TEXT, TEXT, JSONB
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_family_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, UUID[], NUMERIC, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.confirm_family_prepaid_payment(
  UUID, UUID, DATE, TEXT, INTEGER, UUID[], NUMERIC, TEXT, TEXT, JSONB
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.complete_student_registration_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT,
  TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_student_registration_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, DATE, TEXT,
  TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, INTEGER
) TO service_role;
