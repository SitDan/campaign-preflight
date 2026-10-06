/**
 * IP fiable pour l'anti-abus. Sur Vercel, x-real-ip est posé par la
 * plateforme (le client ne peut pas l'imposer). Hors Vercel, aucun header
 * n'est cru : on retourne null et seuls les plafonds globaux s'appliquent.
 */
export function trustedClientIp(request: Request): string | null {
  if (process.env.VERCEL !== "1") return null;
  const value = request.headers.get("x-real-ip")?.trim();
  if (!value || value.length > 64 || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  return value;
}
