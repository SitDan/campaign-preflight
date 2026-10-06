import { z } from "zod";
import { getConfig } from "@/config/env";
import { LIMITS } from "@/config/limits";
import { buildReport } from "@/domain/report";
import { handleError, json, readBoundedJson } from "@/lib/http";
import { log } from "@/lib/log";
import { preflight } from "@/security/cors";
import { getRunDeps } from "@/server/context";
import { bearerOf, widgetCors } from "@/server/route-helpers";
import { ServiceError } from "@/services/errors";
import { createRun } from "@/services/run-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  csv: z.string().max(LIMITS.csvMaxBytes),
  files: z.array(z.object({ name: z.string().min(1).max(LIMITS.shortFieldMaxChars), size: z.number().int().min(0) })).max(20),
});

/** Crée une validation : CSV + inventaire des noms (aucune image, aucune URL). */
export async function POST(request: Request) {
  const cors = widgetCors(request);
  try {
    const parsed = bodySchema.safeParse(await readBoundedJson(request, LIMITS.runRequestMaxBytes));
    if (!parsed.success) throw new ServiceError("invalid_request");
    const deps = getRunDeps();
    const view = await createRun(deps, bearerOf(request), parsed.data);
    log("run.created", { status: 201, count: view.rows.length });
    return json(buildReport(view, deps.ruleset, deps.now()), { status: 201, headers: cors });
  } catch (error) {
    return handleError(error, "run.create_failed", cors);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
