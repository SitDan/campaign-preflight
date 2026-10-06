import { getConfig } from "@/config/env";
import { handleError, json } from "@/lib/http";
import { log } from "@/lib/log";
import { corsHeaders, preflight } from "@/security/cors";
import { getSessionDeps } from "@/server/context";
import { deleteSession, getSessionStatus } from "@/services/session-service";

export const dynamic = "force-dynamic";

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/** État de la session (jamais la clé). */
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"), getConfig().widgetAllowedOrigins);
  try {
    return json(await getSessionStatus(getSessionDeps(), bearer(request)), { headers: cors });
  } catch (error) {
    return handleError(error, "session.status_failed", cors);
  }
}

/** Suppression : retire l'état actif et la clé chiffrée. */
export async function DELETE(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"), getConfig().widgetAllowedOrigins);
  try {
    await deleteSession(getSessionDeps(), bearer(request));
    log("session.deleted", { status: 200 });
    return json({ deleted: true }, { headers: cors });
  } catch (error) {
    return handleError(error, "session.delete_failed", cors);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
