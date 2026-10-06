import { createRedisStore } from "@/adapters/redis-store";
import { getConfig, getServerSecrets } from "@/config/env";
import type { SessionDeps } from "@/services/session-service";
import { inspectImage } from "@/adapters/image";
import { createOpenAiVisionAnalyzer } from "@/adapters/openai-vision";
import { INSTAGRAM_FEED_RULESET } from "@/domain/ruleset";
import { PROMPT_VERSION } from "@/domain/prompt";
import type { RunDeps } from "@/services/run-service";
let deps: SessionDeps | undefined;

/** Dépendances serveur construites à la première requête (jamais au build). */
export function getSessionDeps(): SessionDeps {
  if (deps) return deps;
  const config = getConfig();
  const secrets = getServerSecrets();
  deps = {
    store: createRedisStore({ url: secrets.redisUrl, token: secrets.redisToken }),
    now: () => Date.now(),
    appEnv: config.appEnv,
    master: { key: secrets.masterKey, keyId: secrets.masterKeyId },
    demoEnabled: config.demoEnabled,
    abuse: config.abuse,
  };
  return deps;
}


let runDeps: RunDeps | undefined;

export function getRunDeps(): RunDeps {
  if (runDeps) return runDeps;
  runDeps = {
    ...getSessionDeps(),
    analyzer: createOpenAiVisionAnalyzer(),
    inspect: inspectImage,
    model: getConfig().openaiModel,
    ruleset: INSTAGRAM_FEED_RULESET,
    promptVersion: PROMPT_VERSION,
  };
  return runDeps;
}
