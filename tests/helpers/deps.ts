import { randomBytes } from "node:crypto";
import type { SessionDeps } from "@/services/session-service";
import { MemoryStore } from "./memory-store";

/** Clé canari synthétique : ne doit JAMAIS apparaître en clair hors de l'appel fournisseur. */
export const CANARY_KEY = "sk-canary-0000SYNTHETIC0000-do-not-use-0000";

export function makeClock(start = Date.UTC(2026, 9, 6, 12, 0, 0)) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

export function makeDeps(overrides: Partial<SessionDeps> = {}) {
  const clock = makeClock();
  const store = new MemoryStore(clock.now);
  const deps: SessionDeps = {
    store,
    now: clock.now,
    appEnv: "test",
    master: { key: randomBytes(32), keyId: "k-test" },
    demoEnabled: true,
    abuse: { sessionCreationsPerHourPerIp: 5, setupSubmissionsPerHourPerIp: 20, globalSessionsPerDay: 100, globalAiAttemptsPerDay: 200 },
    ...overrides,
  };
  return { deps, store, clock };
}
