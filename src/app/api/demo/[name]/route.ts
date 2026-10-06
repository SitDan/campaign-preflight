import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/config/env";
import { errorResponse } from "@/lib/http";
import { preflight } from "@/security/cors";
import { widgetCors } from "@/server/route-helpers";

export const dynamic = "force-dynamic";

/** Kit fictif public (aucune donnée privée) : liste fermée de fichiers. */
const FILES: Record<string, string> = {
  "kit.csv": "text/csv; charset=utf-8",
  "kit-invalide.csv": "text/csv; charset=utf-8",
  "modele.csv": "text/csv; charset=utf-8",
  "aurore-fr.jpg": "image/jpeg",
  "aurore-uk.jpg": "image/jpeg",
  "aurore-de.png": "image/png",
};

export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const cors = widgetCors(request);
  const { name } = await params;
  const type = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
  if (!type) return errorResponse("invalid_request", cors);
  const bytes = await readFile(path.join(process.cwd(), "fixtures", "demo", name));
  return new Response(new Uint8Array(bytes), { headers: { ...cors, "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function OPTIONS(request: Request) {
  return preflight(request, getConfig().widgetAllowedOrigins);
}
