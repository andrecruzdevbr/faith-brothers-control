/**
 * generateUUID — gera um UUID v4 com fallback em 3 níveis.
 *
 * crypto.randomUUID() exige Secure Context (HTTPS ou localhost).
 * Quando o app é acessado por IP da rede local (http://192.168.x.x),
 * o navegador não considera isso seguro e crypto.randomUUID() é
 * undefined — quebrando qualquer fluxo que dependa dele (ex: geração
 * de token de sessão de presença/QR Code).
 *
 * Esta função tenta, em ordem:
 *   1. crypto.randomUUID()              — ideal, contexto seguro
 *   2. crypto.getRandomValues() + UUID  — funciona em HTTP também
 *   3. Math.random()                    — último recurso, sempre disponível
 */
export function generateUUID(): string {
  // Nível 1: API nativa, só funciona em contexto seguro
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // cai para o próximo nível
    }
  }

  // Nível 2: crypto.getRandomValues está disponível mesmo em HTTP
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Ajustar para conformidade com UUID v4 (RFC 4122)
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return (
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
      `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
    );
  }

  // Nível 3: último recurso — não criptograficamente seguro, mas nunca falha
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
