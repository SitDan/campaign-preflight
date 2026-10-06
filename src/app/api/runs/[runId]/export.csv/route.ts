import { getConfig } from "@/config/env";
import { buildReport, toExportCsv } from "@/domain/report";
import { NO_STORE, handleError } from "@/lib/http";
import { preflight } from "@/security/cors";
import { getRunDeps } from "@/server/context";
import { bearerOf, widgetCors } from "@/server/route-helpers";
import { getRun } from "@/services/run-service";

export const dynamic = "force-dynamic";

/** Export CSV (une ligne par contrôle/alerte), sans média ni secret. */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const cors = widgetCors(request);
  try {
    const { runId } = await params;
    const deps = getRunDeps();
    const view = await getRun(deps, bearerOf(request), runId);
    const csv = toExportCsv(buildReport(view, deps.ruleset, deps.now()));
    return new Response(csv, {
      headers: {
        ...NO_STORE,
        ...cors,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="campaign-preflight-rapport.csv"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleError(error, "run.export_failed", cors);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
