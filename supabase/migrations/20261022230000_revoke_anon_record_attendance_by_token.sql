-- Check-in RPC is authenticated-only. Default Postgres PUBLIC execute is not required.

REVOKE ALL ON FUNCTION public.record_attendance_by_token(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_attendance_by_token(TEXT)
  TO authenticated, service_role;
