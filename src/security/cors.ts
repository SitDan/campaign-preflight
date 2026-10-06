/**
 * CORS par liste exacte d'origines configurées. Jamais de joker, jamais de
 * reflet d'une origine inconnue, jamais "null". CORS n'est pas une autorisation :
 * les routes privées exigent en plus le bearer de session.
 */
export function corsHeaders(origin: string | null, allowedOrigins: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && origin !== "null" && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: readonly string[]): boolean {
  return Boolean(origin && origin !== "null" && allowedOrigins.includes(origin));
}

/** Réponse de pré-vol : en-têtes CORS uniquement pour une origine autorisée. */
export function preflight(request: Request, allowedOrigins: readonly string[]): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin"), allowedOrigins) });
}
