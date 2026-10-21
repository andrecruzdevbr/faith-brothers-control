/** Soft-handle dashboard graduations when migration/RPC is not applied yet. */

export function isMissingBeltChangesRpc(error: {
  code?: string;
  message?: string;
} | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "PGRST202" ||
    /get_recent_belt_changes|Could not find the function|schema cache/i.test(message)
  );
}
