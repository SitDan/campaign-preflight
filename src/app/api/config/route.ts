import { getConfig } from "@/config/env";
import { LIMITS } from "@/config/limits";
import { json } from "@/lib/http";
import { preflight } from "@/security/cors";
import { widgetCors } from "@/server/route-helpers";

export const dynamic = "force-dynamic";

/** Configuration publique du composant (aucun secret) : disponibilité de la démo et plafonds. */
export async function GET(request: Request) {
  const config = getConfig();
  return json(
    {
      demoKeyAvailable: config.demoEnabled && config.demoKeyAvailable,
      limits: {
        maxRowsPerKit: LIMITS.maxRowsPerKit,
        runsPerSession: LIMITS.runsPerSession,
        demoRunsPerSession: LIMITS.demoRunsPerSession,
      },
    },
    { headers: widgetCors(request) },
  );
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
