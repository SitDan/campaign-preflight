import { getConfig } from "@/config/env";
import { handleError, json } from "@/lib/http";
import { log } from "@/lib/log";
import { corsHeaders, isAllowedOrigin, preflight } from "@/security/cors";
import { trustedClientIp } from "@/security/request-ip";
import { getSessionDeps } from "@/server/context";
import { ServiceError } from "@/services/errors";
import { createSession } from "@/services/session-service";

export const dynamic = "force-dynamic";

/** Création d'une session éphémère, sans clé. Bearer et code retournés une seule fois. */
export async function POST(request: Request) {
  const config = getConfig();
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, config.widgetAllowedOrigins);
  try {
    if (!isAllowedOrigin(origin, config.widgetAllowedOrigins)) throw new ServiceError("forbidden_origin");
    const created = await createSession(getSessionDeps(), { ip: trustedClientIp(request) });
    log("session.created", { status: 201 });
    return json(created, { status: 201, headers: cors });
  } catch (error) {
    return handleError(error, "session.create_failed", cors);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
