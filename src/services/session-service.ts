import { LIMITS } from "@/config/limits";
import {
  displayCode,
  formatBearer,
  newAssociationCode,
  newBearerSecret,
  newSessionId,
  normalizeAssociationCode,
  parseBearer,
  safeEqualHex,
  sha256Hex,
} from "@/security/capability";
import { decryptSecret, encryptSecret, type MasterKey } from "@/security/crypto";
import { ServiceError } from "./errors";
import type { SessionStore, Versioned } from "./store";
import type { SessionDoc } from "./types";

export type SessionDeps = {
  store: SessionStore;
  now: () => number;
  appEnv: string;
  master: MasterKey;
  demoEnabled: boolean;
  abuse: {
    sessionCreationsPerHourPerIp: number;
    setupSubmissionsPerHourPerIp: number;
    globalSessionsPerDay: number;
    globalAiAttemptsPerDay: number;
  };
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function hourBucket(now: number) {
  return Math.floor(now / HOUR_MS);
}

function dayBucket(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Compteur anti-abus : l'IP n'est jamais stockée en clair. */
async function enforce(deps: SessionDeps, key: string, ttlMs: number, limit: number, code: "rate_limited" | "capacity_reached") {
  const count = await deps.store.increment(key, ttlMs);
  if (count > limit) throw new ServiceError(code);
}

export type CreatedSession = {
  bearer: string;
  code: string;
  expiresAt: number;
  codeExpiresAt: number;
};

export async function createSession(deps: SessionDeps, context: { ip: string | null }): Promise<CreatedSession> {
  if (!deps.demoEnabled) throw new ServiceError("demo_disabled");
  const now = deps.now();
  if (context.ip) {
    await enforce(deps, `ip:sess:${sha256Hex(context.ip)}:${hourBucket(now)}`, HOUR_MS, deps.abuse.sessionCreationsPerHourPerIp, "rate_limited");
  }
  await enforce(deps, `global:sess:${dayBucket(now)}`, DAY_MS + HOUR_MS, deps.abuse.globalSessionsPerDay, "capacity_reached");

  const sessionId = newSessionId();
  const secret = newBearerSecret();
  const code = newAssociationCode();
  const expiresAt = now + LIMITS.sessionTtlMs;
  const codeExpiresAt = Math.min(now + LIMITS.associationCodeTtlMs, expiresAt);
  const doc: SessionDoc = {
    schema: 1,
    sessionId,
    bearerHash: sha256Hex(secret),
    codeHash: sha256Hex(code),
    codeExpiresAt,
    createdAt: now,
    expiresAt,
    state: "pending",
    keyEnvelope: null,
    readyAt: null,
    counters: { runs: 0, aiAttempts: 0 },
    activeOperation: null,
    runs: [],
  };
  const created = await deps.store.create(doc, { hash: doc.codeHash as string, expiresAt: codeExpiresAt });
  if (!created) throw new ServiceError("conflict");
  return { bearer: formatBearer(sessionId, secret), code: displayCode(code), expiresAt, codeExpiresAt };
}

/**
 * Dépôt de la clé via le code d'association (usage unique, ≤ 10 min).
 * Chiffrement AVANT écriture ; consommation du code et écriture du
 * ciphertext dans la même opération atomique. Réponse d'échec générique.
 */
export async function depositKey(deps: SessionDeps, input: { code: string; apiKey: string; ip: string | null }): Promise<void> {
  const now = deps.now();
  if (input.ip) {
    await enforce(deps, `ip:setup:${sha256Hex(input.ip)}:${hourBucket(now)}`, HOUR_MS, deps.abuse.setupSubmissionsPerHourPerIp, "rate_limited");
  }
  const code = normalizeAssociationCode(input.code);
  if (!code) throw new ServiceError("association_failed");
  const codeHash = sha256Hex(code);
  const sessionId = await deps.store.findSessionIdByCode(codeHash);
  if (!sessionId) throw new ServiceError("association_failed");
  const current = await deps.store.get(sessionId);
  if (!current) throw new ServiceError("association_failed");
  const { doc, version } = current;
  const valid =
    doc.state === "pending" &&
    doc.keyEnvelope === null &&
    doc.codeHash !== null &&
    safeEqualHex(doc.codeHash, codeHash) &&
    now < doc.codeExpiresAt &&
    now < doc.expiresAt;
  if (!valid) throw new ServiceError("association_failed");

  const keyEnvelope = encryptSecret(input.apiKey, { appEnv: deps.appEnv, sessionId, expiresAt: doc.expiresAt }, deps.master);
  const next: SessionDoc = { ...doc, state: "ready", keyEnvelope, codeHash: null, readyAt: now };
  const result = await deps.store.compareAndSet(sessionId, version, next, { consumeCodeHash: codeHash });
  if (result !== "ok") throw new ServiceError("association_failed");
}

/** Autorisation par possession du bearer : contrôlée à chaque accès. */
export async function authorize(deps: SessionDeps, token: string | null): Promise<Versioned<SessionDoc>> {
  const parsed = token ? parseBearer(token) : null;
  if (!parsed) throw new ServiceError("session_invalid");
  const current = await deps.store.get(parsed.sessionId);
  if (!current || !safeEqualHex(current.doc.bearerHash, sha256Hex(parsed.secret))) throw new ServiceError("session_invalid");
  if (deps.now() >= current.doc.expiresAt) throw new ServiceError("session_expired");
  return current;
}

export type SessionStatus = {
  state: "pending" | "ready";
  expiresAt: number;
  codeActive: boolean;
  runsUsed: number;
  runsLimit: number;
  aiAttemptsUsed: number;
  aiAttemptsLimit: number;
};

export function describeSession(doc: SessionDoc, now: number): SessionStatus {
  return {
    state: doc.state,
    expiresAt: doc.expiresAt,
    codeActive: doc.state === "pending" && now < doc.codeExpiresAt,
    runsUsed: doc.counters.runs,
    runsLimit: LIMITS.runsPerSession,
    aiAttemptsUsed: doc.counters.aiAttempts,
    aiAttemptsLimit: LIMITS.aiAttemptsPerSession,
  };
}

export async function getSessionStatus(deps: SessionDeps, token: string | null): Promise<SessionStatus> {
  const { doc } = await authorize(deps, token);
  return describeSession(doc, deps.now());
}

/** Retire l'état actif (clé chiffrée, résultats, index de code). Idempotent pour le porteur. */
export async function deleteSession(deps: SessionDeps, token: string | null): Promise<void> {
  const { doc } = await authorize(deps, token);
  await deps.store.delete(doc.sessionId, doc.codeHash);
}

/** Déchiffre la clé de la session pour UN appel ; à ne jamais conserver. */
export function readSessionKey(deps: SessionDeps, doc: SessionDoc): string {
  if (doc.state !== "ready" || !doc.keyEnvelope) throw new ServiceError("session_not_ready");
  return decryptSecret(doc.keyEnvelope, { appEnv: deps.appEnv, sessionId: doc.sessionId, expiresAt: doc.expiresAt }, deps.master);
}

/** Réserve une tentative IA dans le plafond global journalier (erreurs comprises). */
export async function reserveGlobalAiAttempt(deps: SessionDeps): Promise<void> {
  const now = deps.now();
  await enforce(deps, `global:ai:${dayBucket(now)}`, DAY_MS + HOUR_MS, deps.abuse.globalAiAttemptsPerDay, "capacity_reached");
}
