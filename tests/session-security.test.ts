import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/config/limits";
import { normalizeAssociationCode, parseBearer } from "@/security/capability";
import { DecryptionError, decryptSecret, encryptSecret } from "@/security/crypto";
import { ServiceError } from "@/services/errors";
import {
  authorize,
  createSession,
  deleteSession,
  depositKey,
  getSessionStatus,
  readSessionKey,
} from "@/services/session-service";
import { CANARY_KEY, makeDeps } from "./helpers/deps";

const code = (error: unknown) => (error instanceof ServiceError ? error.code : String(error));

async function expectCode(promise: Promise<unknown>, expected: string) {
  await expect(promise.then(() => "resolved", code)).resolves.toBe(expected);
}

afterEach(() => vi.restoreAllMocks());

describe("capacités", () => {
  it("bearer de 32 octets aléatoires et code de 16 caractères base32 groupés", async () => {
    const { deps } = makeDeps();
    const created = await createSession(deps, { ip: null });
    const parsed = parseBearer(created.bearer);
    expect(parsed).not.toBeNull();
    expect(Buffer.from(parsed!.secret, "base64url")).toHaveLength(32);
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(created.expiresAt - deps.now()).toBe(LIMITS.sessionTtlMs);
    expect(created.codeExpiresAt - deps.now()).toBe(LIMITS.associationCodeTtlMs);
  });

  it("normalise la saisie du code (casse, espaces, confusions)", () => {
    expect(normalizeAssociationCode("abcd-efgh-jkmn-pqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeAssociationCode("o0il 1111 2222 3333")).toBe("0011111122223333");
    expect(normalizeAssociationCode("ABCD")).toBeNull();
    expect(normalizeAssociationCode("ABCD-EFGH-JKMN-PQRU")).toBeNull();
  });

  it("le stockage ne contient que des empreintes du bearer et du code", async () => {
    const { deps, store } = makeDeps();
    const created = await createSession(deps, { ip: null });
    const dump = store.dump();
    expect(dump).not.toContain(parseBearer(created.bearer)!.secret);
    expect(dump).not.toContain(normalizeAssociationCode(created.code)!);
  });
});

describe("association externe", () => {
  it("dépose la clé chiffrée ; seul le widget propriétaire observe ready", async () => {
    const { deps, store } = makeDeps();
    const a = await createSession(deps, { ip: null });
    const b = await createSession(deps, { ip: null });
    await depositKey(deps, { code: a.code, apiKey: CANARY_KEY, ip: null });
    expect((await getSessionStatus(deps, a.bearer)).state).toBe("ready");
    expect((await getSessionStatus(deps, b.bearer)).state).toBe("pending");
    expect(store.dump()).not.toContain(CANARY_KEY);
    const { doc } = await authorize(deps, a.bearer);
    expect(readSessionKey(deps, doc)).toBe(CANARY_KEY);
  });

  it("refuse un code expiré (10 minutes)", async () => {
    const { deps, clock } = makeDeps();
    const a = await createSession(deps, { ip: null });
    clock.advance(LIMITS.associationCodeTtlMs + 1);
    await expectCode(depositKey(deps, { code: a.code, apiKey: CANARY_KEY, ip: null }), "association_failed");
    expect((await getSessionStatus(deps, a.bearer)).state).toBe("pending");
  });

  it("refuse le rejeu d'un code consommé et le remplacement sur une session ready", async () => {
    const { deps } = makeDeps();
    const a = await createSession(deps, { ip: null });
    await depositKey(deps, { code: a.code, apiKey: CANARY_KEY, ip: null });
    await expectCode(depositKey(deps, { code: a.code, apiKey: "sk-attacker-key-000000000000", ip: null }), "association_failed");
    const { doc } = await authorize(deps, a.bearer);
    expect(readSessionKey(deps, doc)).toBe(CANARY_KEY);
  });

  it("deux dépôts concurrents : un seul réussit", async () => {
    const { deps } = makeDeps();
    const a = await createSession(deps, { ip: null });
    const results = await Promise.allSettled([
      depositKey(deps, { code: a.code, apiKey: CANARY_KEY, ip: null }),
      depositKey(deps, { code: a.code, apiKey: "sk-concurrent-key-0000000000", ip: null }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("le code ne permet ni de lire la clé, ni d'obtenir le bearer, ni d'accéder à la session", async () => {
    const { deps } = makeDeps();
    const a = await createSession(deps, { ip: null });
    await expectCode(getSessionStatus(deps, a.code), "session_invalid");
    await expectCode(authorize(deps, `Bearer ${a.code}`), "session_invalid");
  });

  it("un code inconnu ou mal formé donne la même réponse générique", async () => {
    const { deps } = makeDeps();
    await createSession(deps, { ip: null });
    await expectCode(depositKey(deps, { code: "0000-0000-0000-0000", apiKey: CANARY_KEY, ip: null }), "association_failed");
    await expectCode(depositKey(deps, { code: "x", apiKey: CANARY_KEY, ip: null }), "association_failed");
  });
});

describe("isolation des sessions A/B", () => {
  it("le bearer de A ne donne aucun accès à B, même avec l'identifiant de B", async () => {
    const { deps } = makeDeps();
    const a = await createSession(deps, { ip: null });
    const b = await createSession(deps, { ip: null });
    const pa = parseBearer(a.bearer)!;
    const pb = parseBearer(b.bearer)!;
    await expectCode(authorize(deps, `cps_${pb.sessionId}.${pa.secret}`), "session_invalid");
    await expectCode(deleteSession(deps, `cps_${pb.sessionId}.${pa.secret}`), "session_invalid");
    expect((await getSessionStatus(deps, b.bearer)).state).toBe("pending");
  });

  it("refuse un bearer absent, tronqué ou forgé", async () => {
    const { deps } = makeDeps();
    const a = await createSession(deps, { ip: null });
    await expectCode(authorize(deps, null), "session_invalid");
    await expectCode(authorize(deps, a.bearer.slice(0, -1)), "session_invalid");
    const forged = `${a.bearer.slice(0, -1)}${a.bearer.endsWith("A") ? "B" : "A"}`;
    await expectCode(authorize(deps, forged), "session_invalid");
  });
});

describe("chiffrement", () => {
  const master = { key: randomBytes(32), keyId: "k1" };
  const context = { appEnv: "test", sessionId: "s".repeat(22), expiresAt: 1_800_000_000_000 };

  it("aller-retour et IV neuf à chaque chiffrement", () => {
    const one = encryptSecret(CANARY_KEY, context, master);
    const two = encryptSecret(CANARY_KEY, context, master);
    expect(one.iv).not.toBe(two.iv);
    expect(JSON.stringify(one)).not.toContain(CANARY_KEY);
    expect(decryptSecret(one, context, master)).toBe(CANARY_KEY);
  });

  it("refuse un ciphertext, un tag ou un IV altérés", () => {
    const envelope = encryptSecret(CANARY_KEY, context, master);
    const flip = (b64: string) => {
      const bytes = Buffer.from(b64, "base64");
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      return bytes.toString("base64");
    };
    expect(() => decryptSecret({ ...envelope, ciphertext: flip(envelope.ciphertext) }, context, master)).toThrow(DecryptionError);
    expect(() => decryptSecret({ ...envelope, authTag: flip(envelope.authTag) }, context, master)).toThrow(DecryptionError);
    expect(() => decryptSecret({ ...envelope, iv: flip(envelope.iv) }, context, master)).toThrow(DecryptionError);
  });

  it("refuse une enveloppe déplacée vers une autre session, échéance ou environnement", () => {
    const envelope = encryptSecret(CANARY_KEY, context, master);
    expect(() => decryptSecret(envelope, { ...context, sessionId: "t".repeat(22) }, master)).toThrow(DecryptionError);
    expect(() => decryptSecret(envelope, { ...context, expiresAt: context.expiresAt + 1 }, master)).toThrow(DecryptionError);
    expect(() => decryptSecret(envelope, { ...context, appEnv: "production" }, master)).toThrow(DecryptionError);
    expect(() => decryptSecret(envelope, context, { key: randomBytes(32), keyId: "k1" })).toThrow(DecryptionError);
    expect(() => decryptSecret(envelope, context, { ...master, keyId: "k2" })).toThrow(DecryptionError);
  });

  it("l'enveloppe d'une session A copiée dans B est refusée", async () => {
    const { deps, store } = makeDeps();
    const a = await createSession(deps, { ip: null });
    const b = await createSession(deps, { ip: null });
    await depositKey(deps, { code: a.code, apiKey: CANARY_KEY, ip: null });
    const docA = (await authorize(deps, a.bearer)).doc;
    const current = await store.get(parseBearer(b.bearer)!.sessionId);
    await store.compareAndSet(current!.doc.sessionId, current!.version, { ...current!.doc, state: "ready", keyEnvelope: docA.keyEnvelope });
    const docB = (await authorize(deps, b.bearer)).doc;
    expect(() => readSessionKey(deps, docB)).toThrow(DecryptionError);
  });
});

describe("expiration et suppression", () => {
  it("expiration absolue à 60 minutes, jamais prolongée par une écriture", async () => {
    const { deps, store, clock } = makeDeps();
    const a = await createSession(deps, { ip: null });
    await depositKey(deps, { code: a.code, apiKey: CANARY_KEY, ip: null });
    clock.advance(LIMITS.sessionTtlMs - 1000);
    const current = await authorize(deps, a.bearer);
    await store.compareAndSet(current.doc.sessionId, current.version, { ...current.doc, counters: { runs: 1, aiAttempts: 0 } });
    clock.advance(1000);
    await expectCode(getSessionStatus(deps, a.bearer), "session_invalid");
    expect(store.dump()).not.toContain(current.doc.sessionId);
  });

  it("la suppression retire la clé chiffrée et l'index ; une écriture tardive ne recrée rien", async () => {
    const { deps, store } = makeDeps();
    const a = await createSession(deps, { ip: null });
    const before = await authorize(deps, a.bearer);
    await deleteSession(deps, a.bearer);
    await expectCode(getSessionStatus(deps, a.bearer), "session_invalid");
    expect(await store.compareAndSet(before.doc.sessionId, before.version, before.doc)).toBe("missing");
    await expectCode(depositKey(deps, { code: a.code, apiKey: CANARY_KEY, ip: null }), "association_failed");
    expect(store.dump()).not.toContain(before.doc.sessionId);
  });
});

describe("anti-abus", () => {
  it("5 créations de session par heure et par IP fiable", async () => {
    const { deps, clock } = makeDeps();
    for (let i = 0; i < 5; i++) await createSession(deps, { ip: "203.0.113.7" });
    await expectCode(createSession(deps, { ip: "203.0.113.7" }), "rate_limited");
    await createSession(deps, { ip: "203.0.113.8" });
    clock.advance(60 * 60 * 1000);
    await createSession(deps, { ip: "203.0.113.7" });
  });

  it("plafond global journalier appliqué même sans IP fiable", async () => {
    const { deps } = makeDeps();
    const limited = { ...deps, abuse: { ...deps.abuse, globalSessionsPerDay: 2 } };
    await createSession(limited, { ip: null });
    await createSession(limited, { ip: null });
    await expectCode(createSession(limited, { ip: null }), "capacity_reached");
  });

  it("interrupteur DEMO_ENABLED", async () => {
    const { deps } = makeDeps({ demoEnabled: false });
    await expectCode(createSession(deps, { ip: null }), "demo_disabled");
  });

  it("le stockage anti-abus ne contient pas l'IP en clair", async () => {
    const { deps, store } = makeDeps();
    await createSession(deps, { ip: "203.0.113.7" });
    expect(store.dump()).not.toContain("203.0.113.7");
  });
});
