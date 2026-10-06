import { z } from "zod";
import { getConfig } from "@/config/env";
import { LIMITS } from "@/config/limits";
import { handleError, json, readBoundedJson } from "@/lib/http";
import { log } from "@/lib/log";
import { requireSameOrigin } from "@/security/origin";
import { trustedClientIp } from "@/security/request-ip";
import { getSessionDeps } from "@/server/context";
import { ServiceError } from "@/services/errors";
import { depositKey } from "@/services/session-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  code: z.string().min(1).max(32),
  apiKey: z.string().min(20).max(512).regex(/^sk-[A-Za-z0-9_-]+$/),
});

/**
 * Dépôt same-origin du code + clé. Aucune clé dans les logs, l'URL ou la
 * réponse ; aucun appel OpenAI à cette étape. Réponse générique.
 */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request, getConfig().appOrigin);
    const parsed = bodySchema.safeParse(await readBoundedJson(request, LIMITS.setupBodyMaxBytes));
    if (!parsed.success) throw new ServiceError("association_failed");
    await depositKey(getSessionDeps(), { code: parsed.data.code, apiKey: parsed.data.apiKey, ip: trustedClientIp(request) });
    log("setup.deposited", { status: 200 });
    return json({ ok: true });
  } catch (error) {
    return handleError(error, "setup.rejected");
  }
}
