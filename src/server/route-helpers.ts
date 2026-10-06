import { getConfig } from "@/config/env";
import { corsHeaders } from "@/security/cors";

export function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

export function widgetCors(request: Request): Record<string, string> {
  return corsHeaders(request.headers.get("origin"), getConfig().widgetAllowedOrigins);
}

/** Décodage tolérant d'un segment d'URL (jamais d'exception sur un « % » isolé). */
export function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
