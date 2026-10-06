import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Enveloppe AES-256-GCM versionnée :
 * clé maître serveur 32 octets, IV aléatoire neuf de 12 octets, tag 16 octets.
 * L'AAD canonique lie APP_ENV, sessionId, expiresAt et keyId ; elle est
 * reconstruite depuis le contexte serveur, jamais lue dans l'enveloppe.
 */
export type EncryptedEnvelope = {
  version: 1;
  keyId: string;
  iv: string;
  ciphertext: string;
  authTag: string;
};

export type EnvelopeContext = {
  appEnv: string;
  sessionId: string;
  expiresAt: number;
};

export type MasterKey = { key: Buffer; keyId: string };

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function canonicalAad(context: EnvelopeContext, keyId: string): Buffer {
  return Buffer.from(
    JSON.stringify(["campaign-preflight/byok/v1", context.appEnv, context.sessionId, context.expiresAt, keyId]),
    "utf8",
  );
}

export function encryptSecret(plaintext: string, context: EnvelopeContext, master: MasterKey): EncryptedEnvelope {
  if (master.key.length !== 32) throw new Error("clé maître invalide");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", master.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(canonicalAad(context, master.keyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: 1,
    keyId: master.keyId,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Toute anomalie (version, keyId, contexte, altération) lève une erreur : refus. */
export function decryptSecret(envelope: EncryptedEnvelope, context: EnvelopeContext, master: MasterKey): string {
  if (envelope.version !== 1) throw new DecryptionError();
  if (envelope.keyId !== master.keyId) throw new DecryptionError();
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.authTag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new DecryptionError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", master.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(canonicalAad(context, master.keyId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptionError();
  }
}

export class DecryptionError extends Error {
  readonly code = "decryption_failed";
  constructor() {
    super("déchiffrement refusé");
  }
}
