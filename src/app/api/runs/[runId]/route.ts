import { getConfig } from "@/config/env";
import { buildReport } from "@/domain/report";
import { handleError, json } from "@/lib/http";
import { preflight } from "@/security/cors";
import { getRunDeps } from "@/server/context";
import { bearerOf, widgetCors } from "@/server/route-helpers";
import { getRun } from "@/services/run-service";

export const dynamic = "force-dynamic";

/** Résultats actuels ou partiels ; constate aussi l'expiration des claims. */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const cors = widgetCors(request);
  try {
    const { runId } = await params;
    const deps = getRunDeps();
    const view = await getRun(deps, bearerOf(request), runId);
    return json(buildReport(view, deps.ruleset, deps.now()), { headers: cors });
  } catch (error) {
    return handleError(error, "run.get_failed", cors);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
