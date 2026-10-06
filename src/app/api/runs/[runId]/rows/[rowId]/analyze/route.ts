import { getConfig } from "@/config/env";
import { LIMITS } from "@/config/limits";
import { buildReport } from "@/domain/report";
import { handleError, json, readBoundedBytes } from "@/lib/http";
import { log } from "@/lib/log";
import { preflight } from "@/security/cors";
import { getRunDeps } from "@/server/context";
import { bearerOf, widgetCors } from "@/server/route-helpers";
import { ServiceError } from "@/services/errors";
import { analyzeRow } from "@/services/run-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Une ligne, un fichier multipart binaire, lecture bornée à 3 Mio. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string; rowId: string }> }) {
  const startedAt = Date.now();
  const cors = widgetCors(request);
  try {
    const { runId, rowId } = await params;
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new ServiceError("unsupported_media_type");
    const bytes = await readBoundedBytes(request, LIMITS.imageRequestMaxBytes);
    let form: FormData;
    try {
      form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    } catch {
      throw new ServiceError("invalid_request");
    }
    const entries = [...form.entries()];
    const file = form.get("file");
    if (entries.length !== 1 || !(file instanceof File)) throw new ServiceError("invalid_request", { reason: "Un seul fichier attendu (champ « file »)." });
    const deps = getRunDeps();
    const view = await analyzeRow(deps, bearerOf(request), {
      runId,
      rowId: decodeURIComponent(rowId),
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      startedAt,
    });
    const row = view.rows.find((item) => item.row.rowId === decodeURIComponent(rowId));
    const usage = row?.state.ai?.usage;
    log("row.analyzed", {
      status: 200,
      durationMs: Date.now() - startedAt,
      code: row?.state.ai?.errorCode ?? row?.state.mediaError ?? row?.state.phase,
      model: row?.state.ai?.model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningTokens,
    });
    return json(buildReport(view, deps.ruleset, deps.now()), { headers: cors });
  } catch (error) {
    return handleError(error, "row.analyze_failed", cors);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
