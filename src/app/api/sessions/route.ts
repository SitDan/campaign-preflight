import { getConfig } from "@/config/env";
import { handleError, json, readBoundedJson } from "@/lib/http";
import { log } from "@/lib/log";
import { corsHeaders, isAllowedOrigin, preflight } from "@/security/cors";
import { trustedClientIp } from "@/security/request-ip";
import { getSessionDeps } from "@/server/context";
import { ServiceError } from "@/services/errors";
import { createSession } from "@/services/session-service";

export const dynamic = "force-dynamic";

/**
 * Création d'une session éphémère. Mode « user » (défaut) : bearer + code
 * d'association retournés une seule fois. Mode « demo » (choix explicite) :
 * session prête, clé de démonstration lue côté serveur, jamais transmise.
 */
export async function POST(request: Request) {
  const config = getConfig();
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, config.widgetAllowedOrigins);
  try {
    if (!isAllowedOrigin(origin, config.widgetAllowedOrigins)) throw new ServiceError("forbidden_origin");
    const hasJson = /^application\/json/i.test(request.headers.get("content-type") ?? "");
    const body = hasJson ? ((await readBoundedJson(request, 1024)) as { mode?: unknown }) : {};
    const mode = body?.mode === "demo" ? "demo" : "user";
    const created = await createSession(getSessionDeps(), { ip: trustedClientIp(request), mode });
    log("session.created", { status: 201, code: mode });
    return json(created, { status: 201, headers: cors });
  } catch (error) {
    return handleError(error, "session.create_failed", cors);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
