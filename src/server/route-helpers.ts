import { getConfig } from "@/config/env";
import { corsHeaders } from "@/security/cors";

export function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

export function widgetCors(request: Request): Record<string, string> {
  return corsHeaders(request.headers.get("origin"), getConfig().widgetAllowedOrigins);
}
