import type { SessionDoc } from "./types";

/**
 * Frontière de persistance (une seule interface, brief §6).
 * Toutes les écritures sur une session sont conditionnelles (compare-and-set
 * sur une version) et réappliquent l'échéance ABSOLUE de la session : une
 * session supprimée ou expirée n'est jamais recréée par une écriture tardive.
 */
export type Versioned<T> = { doc: T; version: number };

export type CasResult = "ok" | "conflict" | "missing";

export interface SessionStore {
  /** Crée la session et, s'il y a lieu, l'index du code d'association (échéance ≤ 10 min). */
  create(doc: SessionDoc, code: { hash: string; expiresAt: number } | null): Promise<boolean>;
  get(sessionId: string): Promise<Versioned<SessionDoc> | null>;
  /**
   * Écrit `next` si la session existe et que sa version vaut `expectedVersion`.
   * Avec `consumeCodeHash`, l'index de code doit encore pointer vers la session ;
   * il est supprimé dans la même opération atomique.
   */
  compareAndSet(sessionId: string, expectedVersion: number, next: SessionDoc, options?: { consumeCodeHash?: string }): Promise<CasResult>;
  findSessionIdByCode(codeHash: string): Promise<string | null>;
  delete(sessionId: string, codeHash: string | null): Promise<void>;
  /** Compteur anti-abus atomique, avec sa propre échéance. Retourne la nouvelle valeur. */
  increment(key: string, ttlMs: number): Promise<number>;
}
