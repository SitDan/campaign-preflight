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
  /** Clé de démonstration de l'opérateur, lue à la demande ; null si absente ou désactivée. */
  demoKey: () => string | null;
  abuse: {
    sessionCreationsPerHourPerIp: number;
    setupSubmissionsPerHourPerIp: number;
    globalSessionsPerDay: number;
    globalAiAttemptsPerDay: number;
    globalDemoAiAttemptsPerDay: number;
  };
};

/** Plafonds de la session selon l'origine de la clé (démonstration : plus serrés). */
export function sessionLimits(doc: Pick<SessionDoc, "keySource">): { runs: number; aiAttempts: number } {
  return doc.keySource === "demo"
    ? { runs: LIMITS.demoRunsPerSession, aiAttempts: LIMITS.demoAiAttemptsPerSession }
    : { runs: LIMITS.runsPerSession, aiAttempts: LIMITS.aiAttemptsPerSession };
}

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

export type UserSessionCreated = { bearer: string; code: string; expiresAt: number; codeExpiresAt: number; keySource: "user" };
/** Démonstration : aucune association externe, donc ni code ni échéance de code. */
export type DemoSessionCreated = { bearer: string; code: null; expiresAt: number; codeExpiresAt: null; keySource: "demo" };
export type CreatedSession = UserSessionCreated | DemoSessionCreated;

export async function createSession(deps: SessionDeps, context: { ip: string | null; mode?: "user" }): Promise<UserSessionCreated>;
export async function createSession(deps: SessionDeps, context: { ip: string | null; mode: "demo" }): Promise<DemoSessionCreated>;
export async function createSession(deps: SessionDeps, context: { ip: string | null; mode?: "user" | "demo" }): Promise<CreatedSession>;
export async function createSession(deps: SessionDeps, context: { ip: string | null; mode?: "user" | "demo" }): Promise<CreatedSession> {
  if (!deps.demoEnabled) throw new ServiceError("demo_disabled");
  const demo = context.mode === "demo";
  if (demo && !deps.demoKey()) throw new ServiceError("demo_key_unavailable");
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
    // Démonstration : prête immédiatement, sans code ni clé stockée (la clé reste côté serveur).
    codeHash: demo ? null : sha256Hex(code),
    codeExpiresAt: demo ? now : codeExpiresAt,
    createdAt: now,
    expiresAt,
    state: demo ? "ready" : "pending",
    keySource: demo ? "demo" : "user",
    keyEnvelope: null,
    readyAt: demo ? now : null,
    counters: { runs: 0, aiAttempts: 0 },
    activeOperation: null,
    runs: [],
  };
  const created = await deps.store.create(doc, demo ? null : { hash: doc.codeHash as string, expiresAt: codeExpiresAt });
  if (!created) throw new ServiceError("conflict");
  return demo
    ? { bearer: formatBearer(sessionId, secret), code: null, expiresAt, codeExpiresAt: null, keySource: "demo" }
    : { bearer: formatBearer(sessionId, secret), code: displayCode(code), expiresAt, codeExpiresAt, keySource: "user" };
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
  keySource: "user" | "demo";
  expiresAt: number;
  codeActive: boolean;
  runsUsed: number;
  runsLimit: number;
  aiAttemptsUsed: number;
  aiAttemptsLimit: number;
};

export function describeSession(doc: SessionDoc, now: number): SessionStatus {
  const limits = sessionLimits(doc);
  return {
    state: doc.state,
    keySource: doc.keySource ?? "user",
    expiresAt: doc.expiresAt,
    codeActive: doc.state === "pending" && now < doc.codeExpiresAt,
    runsUsed: doc.counters.runs,
    runsLimit: limits.runs,
    aiAttemptsUsed: doc.counters.aiAttempts,
    aiAttemptsLimit: limits.aiAttempts,
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

/** Clé pour UN appel (déchiffrée, ou clé de démonstration lue côté serveur) ; à ne jamais conserver. */
export function readSessionKey(deps: SessionDeps, doc: SessionDoc): string {
  if (doc.state === "ready" && doc.keySource === "demo") {
    const key = deps.demoKey();
    if (!key) throw new ServiceError("demo_key_unavailable");
    return key;
  }
  if (doc.state !== "ready" || !doc.keyEnvelope) throw new ServiceError("session_not_ready");
  return decryptSecret(doc.keyEnvelope, { appEnv: deps.appEnv, sessionId: doc.sessionId, expiresAt: doc.expiresAt }, deps.master);
}

/** Réserve une tentative IA dans les plafonds globaux journaliers (erreurs comprises). */
export async function reserveGlobalAiAttempt(deps: SessionDeps, doc?: Pick<SessionDoc, "keySource">): Promise<void> {
  const now = deps.now();
  await enforce(deps, `global:ai:${dayBucket(now)}`, DAY_MS + HOUR_MS, deps.abuse.globalAiAttemptsPerDay, "capacity_reached");
  if (doc?.keySource === "demo") {
    await enforce(deps, `global:ai-demo:${dayBucket(now)}`, DAY_MS + HOUR_MS, deps.abuse.globalDemoAiAttemptsPerDay, "capacity_reached");
  }
}
