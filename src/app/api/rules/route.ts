import { getConfig } from "@/config/env";
import { INSTAGRAM_FEED_RULESET } from "@/domain/ruleset";
import { log } from "@/lib/log";
import { describeRequirements } from "@/mcp/server";
import { corsHeaders, isAllowedOrigin } from "@/security/cors";

export const dynamic = "force-dynamic";

/** Règles publiques (aucune donnée privée) : sert aussi de preuve CSP/CORS du composant. */
export async function GET(request: Request) {
  const config = getConfig();
  const origin = request.headers.get("origin");
  log("rules.get", { origin: origin ?? "absent", allowed: isAllowedOrigin(origin, config.widgetAllowedOrigins) });
  return Response.json(describeRequirements(INSTAGRAM_FEED_RULESET), {
    headers: { ...corsHeaders(origin, config.widgetAllowedOrigins), "Cache-Control": "no-store" },
  });
}

export async function OPTIONS(request: Request) {
  const config = getConfig();
  const origin = request.headers.get("origin");
  log("rules.preflight", { origin: origin ?? "absent", allowed: isAllowedOrigin(origin, config.widgetAllowedOrigins) });
  return new Response(null, { status: 204, headers: corsHeaders(origin, config.widgetAllowedOrigins) });
}
