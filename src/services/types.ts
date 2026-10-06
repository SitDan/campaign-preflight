import type { KitManifest, RowState } from "@/domain/types";
import type { EncryptedEnvelope } from "@/security/crypto";

export type ActiveOperation = {
  operationId: string;
  runId: string;
  rowId: string;
  expiresAt: number;
};

export type RunDoc = {
  runId: string;
  createdAt: number;
  rulesetId: string;
  rulesetVersion: string;
  promptVersion: string;
  model: string;
  manifest: KitManifest;
  rows: RowState[];
  aiAttempts: number;
};

/**
 * Document Redis borné, un par session (brief §8) : capacités hachées,
 * clé chiffrée, manifests/résultats et compteurs. Échéance absolue.
 */
export type SessionDoc = {
  schema: 1;
  sessionId: string;
  bearerHash: string;
  codeHash: string | null;
  codeExpiresAt: number;
  createdAt: number;
  expiresAt: number;
  state: "pending" | "ready";
  /** "demo" : clé de démonstration de l'opérateur, jamais stockée ; absent = clé de l'utilisateur. */
  keySource?: "user" | "demo";
  keyEnvelope: EncryptedEnvelope | null;
  readyAt: number | null;
  counters: { runs: number; aiAttempts: number };
  activeOperation: ActiveOperation | null;
  runs: RunDoc[];
};

export function isSessionDoc(value: unknown): value is SessionDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<SessionDoc>;
  return (
    doc.schema === 1 &&
    typeof doc.sessionId === "string" &&
    typeof doc.bearerHash === "string" &&
    typeof doc.expiresAt === "number" &&
    (doc.state === "pending" || doc.state === "ready") &&
    Array.isArray(doc.runs)
  );
}
