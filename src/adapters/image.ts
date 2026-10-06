import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { LIMITS } from "@/config/limits";
import type { ImageFacts } from "@/domain/rules";
import type { MediaError } from "@/domain/types";

/**
 * Inspection d'une image en mémoire (brief §10). Rien n'est écrit sur disque.
 * - JPEG/PNG statiques reconnus par SIGNATURE puis décodage ; MIME/extension ignorés.
 * - Mesures de l'ORIGINAL (dimensions après orientation EXIF).
 * - Copie IA séparée : orientée, sRGB, sans métadonnées, cadre complet, ≤ 2048 px et ≤ 1 Mio.
 * - Protections sharp conservées (limite de pixels de décodage active).
 */
export type InspectionResult =
  | { ok: true; facts: ImageFacts; sha256: string; aiCopy: AiCopy | null; aiCopyIssue: string | null }
  | { ok: false; error: MediaError; sha256: string; facts: ImageFacts | null };

export type AiCopy = { base64: string; mimeType: "image/jpeg"; width: number; height: number; bytes: number };

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function sniffFormat(bytes: Uint8Array): "jpeg" | "png" | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  return null;
}

/** APNG : présence d'un chunk acTL avant les données d'image. */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

export async function inspectImage(bytes: Uint8Array): Promise<InspectionResult> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sniffed = sniffFormat(bytes);
  if (!sniffed) return { ok: false, error: "unsupported_format", sha256, facts: null };
  if (sniffed === "png" && isAnimatedPng(bytes)) return { ok: false, error: "animated", sha256, facts: null };

  let metadata: Metadata;
  try {
    // Lecture des en-têtes seulement ; la protection par défaut de sharp reste active.
    metadata = await sharp(bytes).metadata();
  } catch {
    return { ok: false, error: "corrupt", sha256, facts: null };
  }
  if (metadata.format !== sniffed) return { ok: false, error: "corrupt", sha256, facts: null };
  if ((metadata.pages ?? 1) > 1) return { ok: false, error: "animated", sha256, facts: null };

  const oriented = metadata.autoOrient ?? { width: metadata.width, height: metadata.height };
  const facts: ImageFacts = { format: sniffed, fileBytes: bytes.byteLength, width: oriented.width, height: oriented.height };

  if (bytes.byteLength > LIMITS.imageMaxBytes) return { ok: false, error: "too_large", sha256, facts };
  if (facts.width * facts.height > LIMITS.imageMaxPixels || Math.max(facts.width, facts.height) > LIMITS.imageMaxLongSide) {
    return { ok: false, error: "too_many_pixels", sha256, facts };
  }

  // Décodage complet avec limite de pixels du POC : détecte les fichiers tronqués/corrompus.
  try {
    await sharp(bytes, { limitInputPixels: LIMITS.imageMaxPixels, failOn: "error" }).stats();
  } catch {
    return { ok: false, error: "corrupt", sha256, facts };
  }

  const { aiCopy, issue } = await deriveAiCopy(bytes);
  return { ok: true, facts, sha256, aiCopy, aiCopyIssue: issue };
}

/** Copie pour l'IA : jamais l'original, jamais recadrée ; qualité dégressive bornée. */
export async function deriveAiCopy(bytes: Uint8Array): Promise<{ aiCopy: AiCopy | null; issue: string | null }> {
  for (const quality of [88, 80, 72]) {
    try {
      const { data, info } = await sharp(bytes, { limitInputPixels: LIMITS.imageMaxPixels, failOn: "error" })
        .autoOrient()
        .resize({ width: LIMITS.aiCopyMaxLongSide, height: LIMITS.aiCopyMaxLongSide, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .toColourspace("srgb")
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength <= LIMITS.aiCopyMaxBytes) {
        return {
          aiCopy: { base64: data.toString("base64"), mimeType: "image/jpeg", width: info.width, height: info.height, bytes: data.byteLength },
          issue: null,
        };
      }
    } catch {
      return { aiCopy: null, issue: "copie d'analyse impossible à produire" };
    }
  }
  return { aiCopy: null, issue: "copie d'analyse au-delà de 1 Mio : texte non vérifié" };
}
