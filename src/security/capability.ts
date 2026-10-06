import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Capacités de session :
 * - bearer : 32 octets aléatoires ; le jeton transmis au widget est
 *   « cps_<sessionId>.<secret> » — sessionId sert de localisateur, seul le
 *   secret autorise ; Redis n'en garde que l'empreinte SHA-256.
 * - code d'association : 10 octets aléatoires indépendants → 16 caractères
 *   base32 Crockford, affichés en 4 groupes.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function newSessionId(): string {
  return randomBytes(16).toString("base64url");
}

export function newBearerSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function formatBearer(sessionId: string, secret: string): string {
  return `cps_${sessionId}.${secret}`;
}

const BEARER_PATTERN = /^cps_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

export function parseBearer(token: string): { sessionId: string; secret: string } | null {
  const match = BEARER_PATTERN.exec(token);
  if (!match) return null;
  return { sessionId: match[1] as string, secret: match[2] as string };
}

export function bearerFromRequest(request: Request): { sessionId: string; secret: string } | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return parseBearer(header.slice("Bearer ".length).trim());
}

/** 10 octets = 80 bits = exactement 16 caractères base32. */
export function newAssociationCode(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function displayCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** Normalise une saisie (espaces, tirets, casse, confusions I/L→1, O→0). */
export function normalizeAssociationCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (cleaned.length !== 16) return null;
  for (const char of cleaned) if (!CROCKFORD.includes(char)) return null;
  return cleaned;
}
