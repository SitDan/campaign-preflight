import type { CheckResult, ImageFacts } from "./rules";

/** Une ligne du CSV imposé : une annonce, une locale, une image (brief §5). */
export type KitRow = {
  rowId: string;
  adName: string;
  locale: string;
  placement: string;
  mediaFilename: string;
  primaryText: string;
  cta: string;
  landingUrl: string;
  referenceCollection: string | null;
  referenceOffer: string | null;
  referenceDate: string | null;
  referenceDateLabel: string | null;
};

/** Anomalie de ligne : contrat de kit de ce POC (pas une règle Meta). */
export type RowIssue = {
  field: string;
  code: string;
  message: string;
};

export type ManifestRow = {
  line: number;
  row: KitRow;
  issues: RowIssue[];
  /** Éligible au traitement image + IA : aucune anomalie bloquante. */
  eligible: boolean;
};

export type KitManifest = {
  rows: ManifestRow[];
  warnings: string[];
  unknownColumns: string[];
  excludedFiles: string[];
};

export const FINDING_KINDS = ["language_mismatch", "collection_mismatch", "offer_mismatch", "date_mismatch"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const REFERENCE_FIELDS = ["locale", "reference_collection", "reference_offer", "reference_date"] as const;
export type ReferenceField = (typeof REFERENCE_FIELDS)[number];

export type Observation = {
  text: string;
  legibility: "legible" | "partially_legible" | "illegible";
  language: string | null;
};

export type Finding = {
  kind: FindingKind;
  observedText: string;
  referenceField: ReferenceField;
  /** Valeur attendue retrouvée par le serveur dans le CSV (jamais fournie par le modèle). */
  expected: string;
  explanation: string;
  action: string;
};

export type NotChecked = { check: string; reason: string };

export type AiErrorCode =
  | "invalid_key"
  | "model_unavailable"
  | "quota_exceeded"
  | "rate_limited"
  | "timeout"
  | "refusal"
  | "incomplete"
  | "invalid_output"
  | "provider_error"
  | "network_error"
  | "session_inactive"
  | "budget_exhausted"
  | "image_not_analyzable";

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
};

export type AiReview = {
  status: "completed" | "failed" | "skipped";
  errorCode?: AiErrorCode;
  observations: Observation[];
  findings: Finding[];
  notChecked: NotChecked[];
  /** Constats écartés par le serveur (champ de référence incohérent, référence absente…). */
  discarded: number;
  model?: string;
  usage?: AiUsage;
  latencyMs?: number;
};

export type MediaError = "missing_file" | "name_mismatch" | "too_large" | "unsupported_format" | "animated" | "corrupt" | "too_many_pixels" | "hash_conflict";

export type RowPhase = "awaiting_media" | "processing" | "done" | "row_error" | "interrupted" | "unknown_outcome";

export type RowState = {
  rowId: string;
  phase: RowPhase;
  claim: { operationId: string; expiresAt: number } | null;
  mediaHash: string | null;
  mediaError: MediaError | null;
  facts: ImageFacts | null;
  aiCopy: { width: number; height: number; bytes: number } | null;
  technical: CheckResult[] | null;
  ai: AiReview | null;
  updatedAt: number;
};
