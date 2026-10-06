/**
 * Plafonds PRODUIT du POC. Ce ne sont pas des exigences Meta :
 * un dépassement signifie « non pris en charge par ce POC ».
 * Référence unique : toute vérification serveur lit ces valeurs.
 */
const KIB = 1024;
const MIB = 1024 * KIB;

export const LIMITS = {
  placement: "instagram_feed",
  mediaType: "image",
  locales: ["fr-FR", "en-GB", "de-DE"] as const,

  /** Décision utilisateur du 2026-10-06 (15:47) : 10 annonces / 10 visuels par kit (valeurs initiales : 3 / 3). */
  maxRowsPerKit: 10,
  maxFilesPerKit: 10,
  csvMaxBytes: 64 * KIB,

  imageMaxBytes: 2 * MIB,
  imageMaxPixels: 12_000_000,
  imageMaxLongSide: 6_000,
  imageRequestMaxBytes: 3 * MIB,

  aiCopyMaxLongSide: 2_048,
  aiCopyMaxBytes: 1 * MIB,

  textFieldMaxChars: 1_000,
  shortFieldMaxChars: 250,
  urlMaxChars: 2_048,

  /**
   * Décisions utilisateur du 2026-10-06 : 14:53 (sessions longues) puis 15:47 (kits de 10).
   * 5 validations × 10 annonces = 50 annonces par saisie de clé ; le document de session
   * Redis reste sous ~1 Mo dans le pire cas (≈ 5 à 20 Ko par annonce). Valeurs initiales : 3 / 3 / 9.
   */
  runsPerSession: 5,
  aiAttemptsPerRun: 10,
  aiAttemptsPerSession: 50,
  modelMaxOutputTokens: 2_048,
  heavyOperationsPerSession: 1,

  /** Décision utilisateur du 2026-10-06 (14:53) : 3 h absolues (valeur initiale : 60 min) pour limiter les ressaisies. */
  sessionTtlMs: 3 * 60 * 60 * 1000,
  /** Clé de démonstration de l'opérateur (décision utilisateur du 2026-10-06, 16:10) : plafonds serrés. */
  demoRunsPerSession: 2,
  demoAiAttemptsPerSession: 20,
  associationCodeTtlMs: 10 * 60 * 1000,
  reportMaxBytes: 256 * KIB,

  setupBodyMaxBytes: 8 * KIB,
  runRequestMaxBytes: 80 * KIB,

  /** Échéances d'exécution. */
  rowClaimMaxMs: 75_000,
  appDeadlineMs: 45_000,
  providerTimeoutMs: 30_000,

  /** Bornes du contrat de sortie IA. */
  aiMaxObservations: 10,
  aiMaxFindings: 10,
} as const;

/** Anti-abus : valeurs initiales, surchargeables par l'opérateur (env). */
export const ABUSE_DEFAULTS = {
  sessionCreationsPerHourPerIp: 5,
  setupSubmissionsPerHourPerIp: 20,
  globalSessionsPerDay: 100,
  globalAiAttemptsPerDay: 200,
  /** Analyses payées par la clé de démonstration, tous testeurs confondus. */
  globalDemoAiAttemptsPerDay: 100,
} as const;

export type SupportedLocale = (typeof LIMITS.locales)[number];

/** Durée lisible (« 3 heures », « 60 minutes ») pour les textes d'interface. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes % 60 === 0 && minutes >= 120) return `${minutes / 60} heures`;
  return `${minutes} minutes`;
}

export const SESSION_DURATION_LABEL = formatDuration(LIMITS.sessionTtlMs);
