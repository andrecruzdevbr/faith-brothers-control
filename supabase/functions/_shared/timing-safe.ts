/**
 * Constant-time compare for webhook/cron secrets.
 * Length mismatch returns false without comparing contents.
 */
export function timingSafeEqualString(
  received: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!received || !expected) return false;
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
