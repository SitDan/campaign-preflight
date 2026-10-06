/**
 * Journalisation par liste autorisée : événement, requestId non
 * secret, code, durée, statut, origine du composant, usage numérique.
 * Jamais de corps HTTP, headers, secrets, CSV, prompt ni erreur fournisseur brute.
 */
export type LogFields = {
  requestId?: string;
  code?: string;
  status?: number;
  durationMs?: number;
  origin?: string;
  allowed?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  model?: string;
  count?: number;
};

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "requestId", "code", "status", "durationMs", "origin", "allowed", "inputTokens", "outputTokens", "reasoningTokens", "model", "count",
]);

export function log(event: string, fields: LogFields = {}): void {
  const safe: Record<string, unknown> = { event, at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_KEYS.has(key) || value === undefined) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 200);
    else if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  console.log(JSON.stringify(safe));
}
