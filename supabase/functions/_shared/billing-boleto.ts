/** Bloqueia envio de boletos do ambiente sandbox Asaas. */
export function isSandboxBoletoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("sandbox.asaas.com") ||
    normalized.includes("asaas.com/i/sandbox") ||
    normalized.includes("sandbox.asaas")
  );
}

export function assertSendableBoletoUrl(
  url: string | null | undefined,
): { ok: true; url: string } | { ok: false; reason: "missing_boleto" | "sandbox_boleto" } {
  if (!url?.trim()) return { ok: false, reason: "missing_boleto" };
  if (isSandboxBoletoUrl(url)) return { ok: false, reason: "sandbox_boleto" };
  return { ok: true, url: url.trim() };
}
