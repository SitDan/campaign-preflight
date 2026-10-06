import { ServiceError } from "@/services/errors";

/**
 * /api/setup : JSON same-origin uniquement. Origin exact exigé (absent,
 * "null" ou inattendu = refus) ; un formulaire cross-origin ne peut pas
 * envoyer application/json sans pré-vol CORS, que nous n'autorisons pas.
 */
export function requireSameOrigin(request: Request, appOrigin: string): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== appOrigin) throw new ServiceError("forbidden_origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new ServiceError("forbidden_origin");
}
