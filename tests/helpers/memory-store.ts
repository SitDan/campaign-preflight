import type { CasResult, SessionStore, Versioned } from "@/services/store";
import type { SessionDoc } from "@/services/types";

/**
 * Store en mémoire réservé aux tests : mêmes sémantiques que le script Lua
 * (CAS versionné, échéance absolue, consommation atomique du code).
 * Les documents sont sérialisés comme dans Redis pour inspecter le stockage.
 */
export class MemoryStore implements SessionStore {
  readonly entries = new Map<string, { value: string; version?: number; expiresAt: number }>();

  constructor(private readonly now: () => number) {}

  private live(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async create(doc: SessionDoc, code: { hash: string; expiresAt: number }): Promise<boolean> {
    const key = `cp:s:${doc.sessionId}`;
    if (this.live(key)) return false;
    this.entries.set(key, { value: JSON.stringify(doc), version: 1, expiresAt: doc.expiresAt });
    this.entries.set(`cp:c:${code.hash}`, { value: doc.sessionId, expiresAt: code.expiresAt });
    return true;
  }

  async get(sessionId: string): Promise<Versioned<SessionDoc> | null> {
    const entry = this.live(`cp:s:${sessionId}`);
    if (!entry) return null;
    return { doc: JSON.parse(entry.value) as SessionDoc, version: entry.version ?? 0 };
  }

  async compareAndSet(sessionId: string, expectedVersion: number, next: SessionDoc, options?: { consumeCodeHash?: string }): Promise<CasResult> {
    const key = `cp:s:${sessionId}`;
    const entry = this.live(key);
    if (!entry) return "missing";
    if (entry.version !== expectedVersion) return "conflict";
    if (options?.consumeCodeHash) {
      const code = this.live(`cp:c:${options.consumeCodeHash}`);
      if (!code || code.value !== sessionId) return "conflict";
      this.entries.delete(`cp:c:${options.consumeCodeHash}`);
    }
    this.entries.set(key, { value: JSON.stringify(next), version: expectedVersion + 1, expiresAt: next.expiresAt });
    if (next.expiresAt <= this.now()) this.entries.delete(key);
    return "ok";
  }

  async findSessionIdByCode(codeHash: string): Promise<string | null> {
    return this.live(`cp:c:${codeHash}`)?.value ?? null;
  }

  async delete(sessionId: string, codeHash: string | null): Promise<void> {
    this.entries.delete(`cp:s:${sessionId}`);
    if (codeHash) this.entries.delete(`cp:c:${codeHash}`);
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    const full = `cp:rl:${key}`;
    const entry = this.live(full);
    const value = (entry ? Number(entry.value) : 0) + 1;
    this.entries.set(full, { value: String(value), expiresAt: entry?.expiresAt ?? this.now() + ttlMs });
    return value;
  }

  /** Tout le stockage sérialisé (pour rechercher une clé canari en clair). */
  dump(): string {
    return JSON.stringify([...this.entries.entries()]);
  }
}
