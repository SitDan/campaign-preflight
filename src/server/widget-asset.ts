import { createHash } from "node:crypto";

/**
 * Sert un fichier du composant : revalidation à chaque ouverture (ETag),
 * cache CDN court ; un nouveau déploiement est donc visible immédiatement.
 */
export function widgetAsset(request: Request, body: string, contentType: string): Response {
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": "max-age=60",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
