import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectImage, isAnimatedPng, sniffFormat } from "@/adapters/image";

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } } });

async function jpeg(width: number, height: number, options: { orientation?: number; quality?: number } = {}) {
  let image = solid(width, height).jpeg({ quality: options.quality ?? 80 });
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return new Uint8Array(await image.toBuffer());
}

describe("inspection d'images réelles", () => {
  it("mesure un JPEG original et produit une copie IA sans métadonnées", async () => {
    const bytes = await jpeg(1440, 1800);
    const result = await inspectImage(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts).toEqual({ format: "jpeg", fileBytes: bytes.byteLength, width: 1440, height: 1800 });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    const copy = Buffer.from(result.aiCopy!.base64, "base64");
    const meta = await sharp(copy).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(2048);
    expect(copy.byteLength).toBeLessThanOrEqual(1024 * 1024);
  });

  it("dimensions après orientation EXIF ; copie orientée, cadre complet", async () => {
    const bytes = await jpeg(1800, 1440, { orientation: 6 });
    const result = await inspectImage(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([result.facts.width, result.facts.height]).toEqual([1440, 1800]);
    expect([result.aiCopy!.width, result.aiCopy!.height]).toEqual([1440, 1800]);
    const copyMeta = await sharp(Buffer.from(result.aiCopy!.base64, "base64")).metadata();
    expect(copyMeta.orientation ?? 1).toBe(1);
  });

  it("réduit la copie IA à 2048 px sans toucher aux mesures de l'original", async () => {
    const bytes = await jpeg(3000, 3000, { quality: 40 });
    const result = await inspectImage(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.width).toBe(3000);
    expect(result.aiCopy!.width).toBe(2048);
  });

  it("PNG avec transparence accepté ; signature prioritaire sur l'extension/MIME", async () => {
    const png = new Uint8Array(await sharp({ create: { width: 1080, height: 1080, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    expect(sniffFormat(png)).toBe("png");
    const result = await inspectImage(png);
    expect(result.ok && result.facts.format).toBe("png");
  });

  it("refuse faux MIME (texte), GIF, SVG et fichier tronqué/corrompu", async () => {
    const text = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect((await inspectImage(text)).ok).toBe(false);
    const gif = new Uint8Array(await solid(10, 10).gif().toBuffer());
    const gifResult = await inspectImage(gif);
    expect(gifResult.ok === false && gifResult.error).toBe("unsupported_format");
    const valid = await jpeg(1080, 1350);
    const truncated = valid.subarray(0, Math.floor(valid.byteLength / 3));
    const truncatedResult = await inspectImage(truncated);
    expect(truncatedResult.ok === false && truncatedResult.error).toBe("corrupt");
    const garbage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]);
    const garbageResult = await inspectImage(garbage);
    expect(garbageResult.ok === false && garbageResult.error).toBe("corrupt");
  });

  it("refuse un APNG animé", () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type: string, length = 0) => [0, 0, 0, length, ...type.split("").map((c) => c.charCodeAt(0)), ...new Array(length).fill(0), 0, 0, 0, 0];
    const apng = new Uint8Array([...signature, ...chunk("IHDR", 13), ...chunk("acTL", 8), ...chunk("IDAT", 1)]);
    expect(isAnimatedPng(apng)).toBe(true);
  });

  it("plafonds POC : > 2 Mio ou > 12 Mpx = non pris en charge, mesures conservées", async () => {
    const noisy = new Uint8Array(
      await sharp(Buffer.from(Array.from({ length: 1600 * 1600 * 3 }, () => Math.floor(Math.random() * 256))), { raw: { width: 1600, height: 1600, channels: 3 } })
        .jpeg({ quality: 100 })
        .toBuffer(),
    );
    expect(noisy.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    const heavy = await inspectImage(noisy);
    expect(heavy.ok === false && heavy.error).toBe("too_large");
    expect(heavy.ok === false && heavy.facts?.width).toBe(1600);
    const huge = await inspectImage(await jpeg(4000, 3500, { quality: 10 }));
    expect(huge.ok === false && huge.error).toBe("too_many_pixels");
  });
});
