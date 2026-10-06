import { z } from "zod";

/**
 * Référentiel de règles techniques. Fonctions pures, sans
 * dépendance Next.js / Redis / OpenAI.
 *
 * Natures :
 * - meta_requirement    : exigence lue dans une source officielle Meta
 * - meta_recommendation : recommandation Meta (un écart n'est pas un rejet)
 * - poc_limit           : limite de CE POC, jamais présentée comme règle Meta
 */
export const RULE_NATURES = ["meta_requirement", "meta_recommendation", "poc_limit"] as const;
export type RuleNature = (typeof RULE_NATURES)[number];

export const METRICS = ["format", "file_bytes", "width", "height", "long_side", "pixels", "aspect_ratio", "primary_text_chars"] as const;
export type Metric = (typeof METRICS)[number];

const sourceSchema = z.object({
  url: z.string().url(),
  section: z.string().min(1),
  /** Date ISO de lecture effective de la source ; null = non vérifiée. */
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  quote: z.string().optional(),
});

const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.-]+$/),
  placement: z.literal("instagram_feed"),
  mediaType: z.literal("image"),
  metric: z.enum(METRICS),
  operator: z.enum(["in", "lte", "gte", "between"]),
  value: z.union([z.number(), z.array(z.string()), z.tuple([z.number(), z.number()])]),
  unit: z.enum(["format", "bytes", "px", "pixels", "ratio", "chars"]),
  /** Tolérance relative appliquée aux bornes, uniquement si la source la publie. */
  tolerance: z.number().min(0).max(0.1).optional(),
  nature: z.enum(RULE_NATURES),
  label: z.string().min(1),
  action: z.string().min(1),
  source: sourceSchema.nullable(),
});

export const rulesetSchema = z.object({
  id: z.string(),
  version: z.string(),
  placement: z.literal("instagram_feed"),
  mediaType: z.literal("image"),
  /** Lacunes connues de couverture, affichées telles quelles. */
  coverageNotes: z.array(z.string()),
  rules: z.array(ruleSchema),
});

export type Rule = z.infer<typeof ruleSchema>;
export type Ruleset = z.infer<typeof rulesetSchema>;

export type CheckStatus = "pass" | "fail" | "not_checked" | "not_applicable";

export type CheckResult = {
  ruleId: string;
  origin: RuleNature;
  label: string;
  status: CheckStatus;
  observed: string;
  expected: string;
  action: string;
  sourceUrl: string | null;
  reason?: string;
};

/** Mesures de l'ORIGINAL (après orientation EXIF pour les dimensions). */
export type ImageFacts = {
  format: "jpeg" | "png";
  fileBytes: number;
  width: number;
  height: number;
};

export type RowContext = { placement: string; mediaType: "image"; primaryText?: string };

const RATIO_EPSILON = 1e-9;

export function isVerified(rule: Rule): boolean {
  if (rule.nature === "poc_limit") return true;
  return Boolean(rule.source?.verifiedAt);
}

function metricValue(facts: ImageFacts | null, row: RowContext, metric: Metric): number | string | null {
  if (metric === "primary_text_chars") return row.primaryText === undefined ? null : [...row.primaryText].length;
  if (!facts) return null;
  switch (metric) {
    case "format":
      return facts.format;
    case "file_bytes":
      return facts.fileBytes;
    case "width":
      return facts.width;
    case "height":
      return facts.height;
    case "long_side":
      return Math.max(facts.width, facts.height);
    case "pixels":
      return facts.width * facts.height;
    case "aspect_ratio":
      return facts.width / facts.height;
  }
}

function bounds(rule: Rule): [number, number] | null {
  if (rule.operator !== "between" || !Array.isArray(rule.value) || rule.value.length !== 2) return null;
  const [min, max] = rule.value as [number, number];
  const tolerance = rule.tolerance ?? 0;
  return [min * (1 - tolerance), max * (1 + tolerance)];
}

/** Décimales à la française. */
export function frNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

export function formatValue(value: number | string, unit: Rule["unit"]): string {
  if (typeof value === "string") return value.toUpperCase();
  switch (unit) {
    case "bytes":
      if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000} MB`;
      return value >= 1024 * 1024 ? `${frNumber(value / (1024 * 1024), 2)} Mio` : `${frNumber(value / 1024, 1)} Kio`;
    case "px":
      return `${value} px`;
    case "pixels":
      return `${frNumber(value / 1_000_000, 2)} Mpx`;
    case "ratio":
      return frNumber(value, 3);
    case "chars":
      return `${value} caractères`;
    default:
      return String(value);
  }
}

function expectedText(rule: Rule): string {
  const { operator, value, unit } = rule;
  if (operator === "in" && Array.isArray(value)) return (value as string[]).map((v) => v.toUpperCase()).join(" ou ");
  if (operator === "between" && Array.isArray(value)) {
    const [min, max] = value as [number, number];
    const base = `entre ${formatValue(min, unit)} et ${formatValue(max, unit)}`;
    const tolerated = bounds(rule);
    return rule.tolerance && tolerated
      ? `${base} (tolérance ${rule.tolerance * 100} % : ${formatValue(tolerated[0], unit)}–${formatValue(tolerated[1], unit)})`
      : base;
  }
  if (typeof value === "number") return `${operator === "lte" ? "≤" : "≥"} ${formatValue(value, unit)}`;
  return String(value);
}

function compare(rule: Rule, observed: number | string): boolean {
  const { operator, value } = rule;
  if (operator === "in") return Array.isArray(value) && (value as string[]).includes(String(observed));
  if (typeof observed !== "number") return false;
  if (operator === "lte" && typeof value === "number") return observed <= value;
  if (operator === "gte" && typeof value === "number") return observed >= value;
  const range = bounds(rule);
  if (range) return observed >= range[0] - RATIO_EPSILON && observed <= range[1] + RATIO_EPSILON;
  return false;
}

/**
 * Applique le référentiel aux mesures d'une image. Pure.
 * Donnée manquante, source non vérifiée ou hors périmètre ne donne jamais « pass ».
 */
export function evaluateTechnical(facts: ImageFacts | null, row: RowContext, ruleset: Ruleset): CheckResult[] {
  return ruleset.rules.map((rule) => {
    const base = {
      ruleId: rule.id,
      origin: rule.nature,
      label: rule.label,
      expected: expectedText(rule),
      action: rule.action,
      sourceUrl: rule.source?.url ?? null,
    };
    if (row.placement !== rule.placement || row.mediaType !== rule.mediaType) {
      return { ...base, status: "not_applicable", observed: "—", reason: "placement ou type hors périmètre de la règle" };
    }
    if (!isVerified(rule)) {
      return { ...base, status: "not_checked", observed: "—", reason: "source officielle non vérifiée" };
    }
    const observed = metricValue(facts, row, rule.metric);
    if (observed === null) {
      return { ...base, status: "not_checked", observed: "—", reason: "mesure indisponible" };
    }
    return {
      ...base,
      status: compare(rule, observed) ? "pass" : "fail",
      observed: formatValue(observed, rule.unit),
    };
  });
}

export type Coverage = {
  /** Vrai seulement si format, ratio ET résolution sont couverts par des règles Meta vérifiées. */
  metaTechnicalComplete: boolean;
  verifiedMetaRules: number;
  unverifiedMetaRules: number;
  missing: string[];
  notes: string[];
};

export function describeCoverage(ruleset: Ruleset): Coverage {
  const meta = ruleset.rules.filter((rule) => rule.nature !== "poc_limit");
  const verified = meta.filter(isVerified);
  const covers = (metrics: Metric[]) => verified.some((rule) => metrics.includes(rule.metric));
  const missing: string[] = [];
  if (!covers(["format"])) missing.push("format");
  if (!covers(["aspect_ratio"])) missing.push("ratio");
  if (!covers(["width", "height", "long_side", "pixels"])) missing.push("résolution");
  return {
    metaTechnicalComplete: missing.length === 0,
    verifiedMetaRules: verified.length,
    unverifiedMetaRules: meta.length - verified.length,
    missing,
    notes: ruleset.coverageNotes,
  };
}
