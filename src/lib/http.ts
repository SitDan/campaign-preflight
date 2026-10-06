import { ConfigError } from "@/config/env";
import { ServiceError, errorBody, type ServiceErrorCode } from "@/services/errors";
import { log } from "./log";

export const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } as const;

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, { status: init.status ?? 200, headers: { ...NO_STORE, ...init.headers } });
}

export function errorResponse(code: ServiceErrorCode, headers: Record<string, string> = {}, details?: Record<string, unknown>): Response {
  return json(errorBody(code, details), { status: new ServiceError(code).status, headers });
}

/** Convertit toute erreur en réponse contrôlée ; ne journalise qu'un code. */
export function handleError(error: unknown, event: string, headers: Record<string, string> = {}): Response {
  if (error instanceof ServiceError) {
    log(event, { code: error.code, status: error.status });
    return json(errorBody(error.code, error.details), { status: error.status, headers });
  }
  if (error instanceof ConfigError) {
    log(event, { code: "config_error", status: 503 });
    return errorResponse("config_error", headers);
  }
  const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code).slice(0, 40) : "internal_error";
  log(event, { code: code === "store_corrupted" ? code : "internal_error", status: 500 });
  return errorResponse("internal_error", headers);
}

/**
 * Lecture bornée du corps : Content-Length ne suffit pas, on compte les
 * octets réellement lus et on interrompt au-delà du plafond.
 */
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new ServiceError("payload_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ServiceError("payload_too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(contentType)) throw new ServiceError("unsupported_media_type");
  const bytes = await readBoundedBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ServiceError("invalid_request");
  }
}
