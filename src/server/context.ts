import { createRedisStore } from "@/adapters/redis-store";
import { getConfig, getServerSecrets } from "@/config/env";
import type { SessionDeps } from "@/services/session-service";

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
