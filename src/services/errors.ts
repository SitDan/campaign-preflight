/** Erreurs métier contrôlées : code stable + statut HTTP + message français. */
const ERRORS = {
  demo_disabled: [503, "La démonstration est temporairement désactivée."],
  rate_limited: [429, "Trop de demandes depuis cette connexion. Réessayez plus tard."],
  capacity_reached: [503, "Capacité journalière de la démonstration atteinte. Réessayez demain."],
  conflict: [409, "Opération concurrente détectée. Réessayez."],
  association_failed: [400, "Code invalide, expiré ou déjà utilisé. Créez une nouvelle session depuis le composant."],
  session_invalid: [401, "Session inconnue, supprimée ou expirée. Créez une nouvelle session."],
  session_expired: [401, "Session expirée. Créez une nouvelle session."],
  session_not_ready: [409, "Aucune clé n'est encore associée à cette session."],
  invalid_request: [400, "Requête invalide."],
  payload_too_large: [413, "Contenu trop volumineux pour ce POC."],
  forbidden_origin: [403, "Origine non autorisée."],
  unsupported_media_type: [415, "Type de contenu non pris en charge."],
  import_rejected: [422, "Import refusé : corrigez le kit puis réessayez."],
  run_limit_reached: [429, "Nombre maximal de validations atteint pour cette session (3)."],
  run_not_found: [404, "Validation introuvable pour cette session."],
  row_not_found: [404, "Annonce introuvable dans cette validation."],
  row_not_eligible: [409, "Cette annonce présente des anomalies bloquantes : aucune analyse."],
  operation_in_progress: [409, "Une analyse est déjà en cours pour cette session."],
  media_conflict: [409, "Un autre fichier a déjà été analysé pour cette annonce."],
  store_unavailable: [503, "Stockage temporaire indisponible. Réessayez."],
  config_error: [503, "Service mal configuré."],
  internal_error: [500, "Erreur interne."],
} as const satisfies Record<string, readonly [number, string]>;

export type ServiceErrorCode = keyof typeof ERRORS;

export class ServiceError extends Error {
  readonly status: number;
  constructor(readonly code: ServiceErrorCode, readonly details?: Record<string, unknown>) {
    super(ERRORS[code][1]);
    this.status = ERRORS[code][0];
  }
}

export function errorBody(code: ServiceErrorCode, details?: Record<string, unknown>) {
  return { error: { code, message: ERRORS[code][1], ...(details ? { details } : {}) } };
}

export function statusOf(code: ServiceErrorCode): number {
  return ERRORS[code][0];
}
