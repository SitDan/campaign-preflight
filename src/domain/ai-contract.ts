import { z } from "zod";
import { LIMITS } from "@/config/limits";
import { FINDING_KINDS, REFERENCE_FIELDS, type Finding, type FindingKind, type KitRow, type NotChecked, type Observation, type ReferenceField } from "./types";

/**
 * Contrat de sortie du modèle. Le schéma JSON strict est envoyé
 * à l'API ; la validation zod côté serveur ajoute les bornes de longueur
 * (non garanties par le sous-ensemble strict). Toute sortie hors contrat =
 * revue non achevée.
 */
export const LANGUAGES = ["fr", "en", "de", "other", "undetermined"] as const;
export const CHECKS = ["visible_text", "language", "collection", "offer", "date"] as const;

export const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observations", "findings", "notChecked"],
  properties: {
    observations: {
      type: "array",
      maxItems: LIMITS.aiMaxObservations,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "legibility", "language"],
        properties: {
          text: { type: "string", description: "Texte visible transcrit tel quel, court (≤ 300 caractères)." },
          legibility: { type: "string", enum: ["legible", "partially_legible", "illegible"] },
          language: { type: "string", enum: [...LANGUAGES] },
        },
      },
    },
    findings: {
      type: "array",
      maxItems: LIMITS.aiMaxFindings,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "observedText", "referenceField", "explanation", "action"],
        properties: {
          kind: { type: "string", enum: [...FINDING_KINDS] },
          observedText: { type: "string", description: "Citation courte exacte du texte visible concerné." },
          referenceField: { type: "string", enum: [...REFERENCE_FIELDS] },
          explanation: { type: "string", description: "Explication brève en français." },
          action: { type: "string", description: "Correction à demander à l'agence, en français." },
        },
      },
    },
    notChecked: {
      type: "array",
      maxItems: CHECKS.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["check", "reason"],
        properties: {
          check: { type: "string", enum: [...CHECKS] },
          reason: { type: "string", description: "Raison brève en français." },
        },
      },
    },
  },
} as const;

const bounded = (max: number) => z.string().trim().min(1).max(max);

export const modelOutputSchema = z.object({
  observations: z
    .array(z.object({ text: z.string().max(300), legibility: z.enum(["legible", "partially_legible", "illegible"]), language: z.enum(LANGUAGES) }))
    .max(LIMITS.aiMaxObservations),
  findings: z
    .array(
      z.object({
        kind: z.enum(FINDING_KINDS),
        observedText: bounded(300),
        referenceField: z.enum(REFERENCE_FIELDS),
        explanation: bounded(600),
        action: bounded(300),
      }),
    )
    .max(LIMITS.aiMaxFindings),
  notChecked: z.array(z.object({ check: z.enum(CHECKS), reason: bounded(300) })).max(CHECKS.length),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

export const KIND_TO_FIELD: Record<FindingKind, ReferenceField> = {
  language_mismatch: "locale",
  collection_mismatch: "reference_collection",
  offer_mismatch: "reference_offer",
  date_mismatch: "reference_date",
};

export const LOCALE_LANGUAGE: Record<string, "fr" | "en" | "de"> = { "fr-FR": "fr", "en-GB": "en", "de-DE": "de" };

/** Valeur attendue retrouvée par le SERVEUR dans la ligne du CSV. */
export function expectedValue(row: KitRow, field: ReferenceField): string | null {
  switch (field) {
    case "locale":
      return row.locale || null;
    case "reference_collection":
      return row.referenceCollection;
    case "reference_offer":
      return row.referenceOffer;
    case "reference_date":
      return row.referenceDate ? `${row.referenceDate} (${row.referenceDateLabel ?? "rôle non précisé"})` : null;
  }
}

/**
 * Rattache les constats à la ligne : le modèle ne choisit ni le propriétaire
 * ni la référence. Constat incohérent (champ ≠ type) ou sans référence
 * fournie : écarté et compté.
 */
export function reconcile(output: ModelOutput, row: KitRow): { observations: Observation[]; findings: Finding[]; notChecked: NotChecked[]; discarded: number } {
  let discarded = 0;
  const findings: Finding[] = [];
  for (const finding of output.findings) {
    const field = KIND_TO_FIELD[finding.kind];
    const expected = expectedValue(row, field);
    if (finding.referenceField !== field || !expected) {
      discarded += 1;
      continue;
    }
    findings.push({ ...finding, referenceField: field, expected });
  }
  return {
    observations: output.observations.map((item) => ({
      text: item.text,
      legibility: item.legibility,
      language: item.language === "undetermined" ? null : item.language,
    })),
    findings,
    notChecked: output.notChecked,
    discarded,
  };
}
