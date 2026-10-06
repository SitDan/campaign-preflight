import type { Report } from "@/domain/report";

/**
 * Client HTTP du composant. Le bearer vit uniquement dans cette fermeture :
 * jamais dans l'état de l'hôte, le contexte du modèle, une URL ou un stockage
 * navigateur. Rechargement du composant = nouvelle session.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

export type SessionCreated = { code: string | null; expiresAt: number; codeExpiresAt: number | null; keySource: "user" | "demo" };
export type SessionStatus = {
  state: "pending" | "ready";
  keySource: "user" | "demo";
  expiresAt: number;
  codeActive: boolean;
  runsUsed: number;
  runsLimit: number;
  aiAttemptsUsed: number;
  aiAttemptsLimit: number;
};
export type PublicConfig = { demoKeyAvailable: boolean; limits: { maxRowsPerKit: number; runsPerSession: number; demoRunsPerSession: number } };

let bearer: string | null = null;

export function hasSession(): boolean {
  return bearer !== null;
}

export function forgetSession(): void {
  bearer = null;
}

async function call<T>(apiBase: string, path: string, init: RequestInit & { auth?: boolean; text?: boolean } = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  if (init.auth) {
    if (!bearer) return { ok: false, status: 401, code: "session_invalid", message: "Aucune session active : configurez d'abord votre clé." };
    headers.set("Authorization", `Bearer ${bearer}`);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  } catch {
    return { ok: false, status: 0, code: "network_error", message: "Service injoignable depuis le composant (réseau ou politique de l'hôte)." };
  }
  if (response.ok) {
    return { ok: true, data: (init.text ? await response.text() : await response.json()) as T };
  }
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
  return {
    ok: false,
    status: response.status,
    code: body.error?.code ?? "http_error",
    message: body.error?.message ?? `Erreur HTTP ${response.status}.`,
    details: body.error?.details,
  };
}

export function createApi(apiBase: string) {
  return {
    async createSession(mode: "user" | "demo" = "user"): Promise<ApiResult<SessionCreated>> {
      const result = await call<SessionCreated & { bearer: string }>(apiBase, "/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!result.ok) return result;
      bearer = result.data.bearer;
      return { ok: true, data: { code: result.data.code, expiresAt: result.data.expiresAt, codeExpiresAt: result.data.codeExpiresAt, keySource: result.data.keySource } };
    },
    getConfig: () => call<PublicConfig>(apiBase, "/api/config"),
    getSession: () => call<SessionStatus>(apiBase, "/api/session", { auth: true }),
    async deleteSession(): Promise<ApiResult<{ deleted: boolean }>> {
      const result = await call<{ deleted: boolean }>(apiBase, "/api/session", { method: "DELETE", auth: true });
      bearer = null;
      return result;
    },
    createRun: (csv: string, files: Array<{ name: string; size: number }>) =>
      call<Report>(apiBase, "/api/runs", { method: "POST", auth: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv, files }) }),
    getRun: (runId: string) => call<Report>(apiBase, `/api/runs/${encodeURIComponent(runId)}`, { auth: true }),
    analyzeRow(runId: string, rowId: string, file: File) {
      const form = new FormData();
      form.append("file", file, file.name);
      return call<Report>(apiBase, `/api/runs/${encodeURIComponent(runId)}/rows/${encodeURIComponent(rowId)}/analyze`, { method: "POST", auth: true, body: form });
    },
    exportCsv: (runId: string) => call<string>(apiBase, `/api/runs/${encodeURIComponent(runId)}/export.csv`, { auth: true, text: true }),
    getRules: () => call<{ rulesetVersion: string; metaRules: unknown[] }>(apiBase, "/api/rules"),
    async demoFile(name: string, type: string): Promise<File | null> {
      try {
        const response = await fetch(`${apiBase}/api/demo/${encodeURIComponent(name)}`, { credentials: "omit", cache: "no-store" });
        if (!response.ok) return null;
        return new File([await response.blob()], name, { type });
      } catch {
        return null;
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
