/**
 * Plafonds PRODUIT du POC (brief §3). Ce ne sont pas des exigences Meta :
 * un dépassement signifie « non pris en charge par ce POC ».
 * Référence unique : toute vérification serveur lit ces valeurs.
 */
const KIB = 1024;
const MIB = 1024 * KIB;

export const LIMITS = {
  placement: "instagram_feed",
  mediaType: "image",
  locales: ["fr-FR", "en-GB", "de-DE"] as const,

  maxRowsPerKit: 3,
  maxFilesPerKit: 3,
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

  runsPerSession: 3,
  aiAttemptsPerRun: 3,
  aiAttemptsPerSession: 9,
  modelMaxOutputTokens: 2_048,
  heavyOperationsPerSession: 1,

  sessionTtlMs: 60 * 60 * 1000,
  associationCodeTtlMs: 10 * 60 * 1000,
  reportMaxBytes: 256 * KIB,

  setupBodyMaxBytes: 8 * KIB,
  runRequestMaxBytes: 80 * KIB,

  /** Échéances d'exécution (brief §9). */
  rowClaimMaxMs: 75_000,
  appDeadlineMs: 45_000,
  providerTimeoutMs: 30_000,

  /** Bornes du contrat de sortie IA (brief §11). */
  aiMaxObservations: 10,
  aiMaxFindings: 10,
} as const;

/** Anti-abus : valeurs initiales, surchargeables par l'opérateur (env). */
export const ABUSE_DEFAULTS = {
  sessionCreationsPerHourPerIp: 5,
  setupSubmissionsPerHourPerIp: 20,
  globalSessionsPerDay: 100,
  globalAiAttemptsPerDay: 200,
} as const;

export type SupportedLocale = (typeof LIMITS.locales)[number];
