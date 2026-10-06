import { createHash, randomUUID } from "node:crypto";
import { LIMITS } from "@/config/limits";
import type { InspectionResult } from "@/adapters/image";
import type { VisionAnalyzer } from "@/adapters/openai-vision";
import { reconcile } from "@/domain/ai-contract";
import { parseKit, type InventoryFile } from "@/domain/kit";
import { evaluateTechnical, type Ruleset } from "@/domain/rules";
import type { AiErrorCode, AiReview, ManifestRow, RowState } from "@/domain/types";
import { ServiceError } from "./errors";
import { authorize, readSessionKey, reserveGlobalAiAttempt, sessionLimits, type SessionDeps } from "./session-service";
import type { Versioned } from "./store";
import type { RunDoc, SessionDoc } from "./types";

export type RunDeps = SessionDeps & {
  analyzer: VisionAnalyzer;
  inspect: (bytes: Uint8Array) => Promise<InspectionResult>;
  model: string;
  ruleset: Ruleset;
  promptVersion: string;
};

/**
 * Applique une transformation au document de session par compare-and-set.
 * Revérifie l'existence et l'échéance à chaque tentative ; quelques essais en
 * cas de conflit de version (jamais d'appel IA dans `apply`).
 */
async function mutate<T>(deps: SessionDeps, sessionId: string, apply: (doc: SessionDoc, now: number) => { next: SessionDoc; result: T }): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await deps.store.get(sessionId);
    const now = deps.now();
    if (!current || now >= current.doc.expiresAt) throw new ServiceError("session_invalid");
    const { next, result } = apply(structuredClone(current.doc), now);
    const status = await deps.store.compareAndSet(sessionId, current.version, next);
    if (status === "ok") return result;
    if (status === "missing") throw new ServiceError("session_invalid");
  }
  throw new ServiceError("conflict");
}

function findRun(doc: SessionDoc, runId: string): RunDoc {
  const run = doc.runs.find((item) => item.runId === runId);
  if (!run) throw new ServiceError("run_not_found");
  return run;
}

function findRow(run: RunDoc, rowId: string): { manifest: ManifestRow; state: RowState } {
  const manifest = run.manifest.rows.find((item) => item.row.rowId === rowId);
  const state = run.rows.find((item) => item.rowId === rowId);
  if (!manifest || !state) throw new ServiceError("row_not_found");
  return { manifest, state };
}

/** Constate les claims expirés (sans cron) : traitement interrompu, pas de relance. */
function settleExpiredClaims(doc: SessionDoc, now: number): boolean {
  let changed = false;
  for (const run of doc.runs) {
    for (const row of run.rows) {
      if (row.phase === "processing" && row.claim && row.claim.expiresAt <= now) {
        row.phase = row.ai ? "done" : "interrupted";
        row.claim = null;
        row.updatedAt = now;
        changed = true;
      }
    }
  }
  if (doc.activeOperation && doc.activeOperation.expiresAt <= now) {
    doc.activeOperation = null;
    changed = true;
  }
  return changed;
}

export type RunView = {
  runId: string;
  createdAt: number;
  rulesetId: string;
  rulesetVersion: string;
  promptVersion: string;
  model: string;
  warnings: string[];
  rows: Array<{ line: number; row: ManifestRow["row"]; issues: ManifestRow["issues"]; eligible: boolean; state: RowState }>;
  session: { expiresAt: number; runsUsed: number; aiAttemptsUsed: number; aiAttemptsLimit: number };
};

export function toRunView(doc: SessionDoc, run: RunDoc): RunView {
  return {
    runId: run.runId,
    createdAt: run.createdAt,
    rulesetId: run.rulesetId,
    rulesetVersion: run.rulesetVersion,
    promptVersion: run.promptVersion,
    model: run.model,
    warnings: run.manifest.warnings,
    rows: run.manifest.rows.map((manifest) => ({
      line: manifest.line,
      row: manifest.row,
      issues: manifest.issues,
      eligible: manifest.eligible,
      state: run.rows.find((state) => state.rowId === manifest.row.rowId) as RowState,
    })),
    session: {
      expiresAt: doc.expiresAt,
      runsUsed: doc.counters.runs,
      aiAttemptsUsed: doc.counters.aiAttempts,
      aiAttemptsLimit: sessionLimits(doc).aiAttempts,
    },
  };
}

export async function createRun(deps: RunDeps, token: string | null, input: { csv: string; files: InventoryFile[] }): Promise<RunView> {
  const { doc } = await authorize(deps, token);
  if (doc.state !== "ready") throw new ServiceError("session_not_ready");
  const imported = parseKit(input.csv, input.files);
  if (!imported.ok) throw new ServiceError("import_rejected", { errors: imported.errors });
  const runId = randomUUID();
  return mutate(deps, doc.sessionId, (current, now) => {
    if (current.state !== "ready") throw new ServiceError("session_not_ready");
    if (current.counters.runs >= sessionLimits(current).runs) throw new ServiceError("run_limit_reached");
    const run: RunDoc = {
      runId,
      createdAt: now,
      rulesetId: deps.ruleset.id,
      rulesetVersion: deps.ruleset.version,
      promptVersion: deps.promptVersion,
      model: deps.model,
      manifest: imported.manifest,
      aiAttempts: 0,
      rows: imported.manifest.rows.map((manifest) => ({
        rowId: manifest.row.rowId,
        phase: manifest.eligible ? "awaiting_media" : "row_error",
        claim: null,
        mediaHash: null,
        mediaError: null,
        facts: null,
        aiCopy: null,
        technical: null,
        ai: null,
        updatedAt: now,
      })),
    };
    current.counters.runs += 1;
    current.runs.push(run);
    return { next: current, result: toRunView(current, run) };
  });
}

export async function getRun(deps: RunDeps, token: string | null, runId: string): Promise<RunView> {
  const { doc } = await authorize(deps, token);
  findRun(doc, runId);
  if (!settleExpiredClaims(structuredClone(doc), deps.now())) return toRunView(doc, findRun(doc, runId));
  return mutate(deps, doc.sessionId, (current, now) => {
    settleExpiredClaims(current, now);
    return { next: current, result: toRunView(current, findRun(current, runId)) };
  });
}

type ClaimOutcome = { kind: "claimed"; operationId: string; claimExpiresAt: number } | { kind: "existing"; view: RunView };

function failedReview(errorCode: AiErrorCode, extra: Partial<AiReview> = {}): AiReview {
  return { status: errorCode === "image_not_analyzable" || errorCode === "budget_exhausted" ? "skipped" : "failed", errorCode, observations: [], findings: [], notChecked: [], discarded: 0, ...extra };
}

/**
 * Analyse d'UNE ligne : une requête, une image, séquentiel. Claim atomique,
 * mesures persistées avant l'IA, tentative IA réservée avant l'envoi,
 * écriture finale conditionnelle au claim courant. Aucun retry.
 */
export async function analyzeRow(
  deps: RunDeps,
  token: string | null,
  params: { runId: string; rowId: string; filename: string; bytes: Uint8Array; startedAt: number },
): Promise<RunView> {
  const { doc } = await authorize(deps, token);
  const sessionId = doc.sessionId;
  if (doc.state !== "ready") throw new ServiceError("session_not_ready");
  const { manifest } = findRow(findRun(doc, params.runId), params.rowId);
  if (params.filename !== manifest.row.mediaFilename) throw new ServiceError("invalid_request", { reason: "Le fichier ne correspond pas à media_filename." });

  const sha256 = createHash("sha256").update(params.bytes).digest("hex");

  // 1. Claim atomique AVANT le décodage (une opération lourde par session).
  const claim = await mutate<ClaimOutcome>(deps, sessionId, (current, now) => {
    settleExpiredClaims(current, now);
    const run = findRun(current, params.runId);
    const { manifest: rowManifest, state } = findRow(run, params.rowId);
    if (!rowManifest.eligible) throw new ServiceError("row_not_eligible");
    if (state.phase === "processing") throw new ServiceError("operation_in_progress");
    if (state.phase !== "awaiting_media") return { next: current, result: { kind: "existing", view: toRunView(current, run) } };
    if (state.mediaHash && state.mediaHash !== sha256) throw new ServiceError("media_conflict");
    if (current.activeOperation) throw new ServiceError("operation_in_progress");
    const operationId = randomUUID();
    const claimExpiresAt = Math.min(now + LIMITS.rowClaimMaxMs, current.expiresAt);
    state.phase = "processing";
    state.claim = { operationId, expiresAt: claimExpiresAt };
    state.mediaHash = sha256;
    state.updatedAt = now;
    current.activeOperation = { operationId, runId: params.runId, rowId: params.rowId, expiresAt: claimExpiresAt };
    return { next: current, result: { kind: "claimed", operationId, claimExpiresAt } };
  });
  if (claim.kind === "existing") return claim.view;
  const { operationId } = claim;

  /** Écriture conditionnelle : session active, claim courant et non expiré. */
  const writeRow = (update: (state: RowState, current: SessionDoc, run: RunDoc, now: number) => void, release: boolean) =>
    mutate<RunView | null>(deps, sessionId, (current, now) => {
      const run = findRun(current, params.runId);
      const { state } = findRow(run, params.rowId);
      if (!state.claim || state.claim.operationId !== operationId || state.claim.expiresAt <= now) {
        return { next: current, result: null };
      }
      update(state, current, run, now);
      state.updatedAt = now;
      if (release) {
        state.claim = null;
        if (current.activeOperation?.operationId === operationId) current.activeOperation = null;
      }
      return { next: current, result: toRunView(current, run) };
    });

  const lost = async () => getRun(deps, token, params.runId);

  let inspection: InspectionResult;
  try {
    inspection = await deps.inspect(params.bytes);
  } catch {
    return (
      (await writeRow((state) => {
        state.phase = "interrupted";
      }, true)) ?? (await lost())
    );
  }

  // 2. Mesures et règles techniques, persistées avant tout appel IA.
  const rowContext = { placement: manifest.row.placement, mediaType: "image" as const, primaryText: manifest.row.primaryText };
  const technical = evaluateTechnical(inspection.facts, rowContext, deps.ruleset);
  if (!inspection.ok) {
    return (
      (await writeRow((state) => {
        state.facts = inspection.facts;
        state.mediaError = inspection.error;
        state.technical = technical;
        state.ai = failedReview("image_not_analyzable");
        state.phase = "done";
      }, true)) ?? (await lost())
    );
  }
  const persisted = await writeRow((state) => {
    state.facts = inspection.facts;
    state.technical = technical;
    state.aiCopy = inspection.aiCopy ? { width: inspection.aiCopy.width, height: inspection.aiCopy.height, bytes: inspection.aiCopy.bytes } : null;
  }, false);
  if (!persisted) return lost();

  const finish = async (review: AiReview, phase: RowState["phase"] = "done") =>
    (await writeRow((state) => {
      state.ai = review;
      state.phase = phase;
    }, true)) ?? (await lost());

  if (!inspection.aiCopy) return finish(failedReview("image_not_analyzable", { notChecked: [{ check: "visible_text", reason: inspection.aiCopyIssue ?? "copie d'analyse indisponible" }] }));

  // 3. Réservation d'une tentative IA (session, run, global) — erreurs comprises.
  try {
    await reserveGlobalAiAttempt(deps, doc);
  } catch {
    return finish(failedReview("budget_exhausted"));
  }
  const reserved = await mutate<boolean>(deps, sessionId, (current) => {
    const run = findRun(current, params.runId);
    const { state } = findRow(run, params.rowId);
    if (!state.claim || state.claim.operationId !== operationId) return { next: current, result: false };
    if (current.counters.aiAttempts >= sessionLimits(current).aiAttempts || run.aiAttempts >= LIMITS.aiAttemptsPerRun) {
      return { next: current, result: false };
    }
    current.counters.aiAttempts += 1;
    run.aiAttempts += 1;
    return { next: current, result: true };
  });
  if (!reserved) return finish(failedReview("budget_exhausted"));

  // 4. Revérifier la session juste avant l'envoi, puis déchiffrer la clé pour CET appel.
  const fresh = await deps.store.get(sessionId);
  const now = deps.now();
  const freshRow = fresh ? fresh.doc.runs.find((run) => run.runId === params.runId)?.rows.find((row) => row.rowId === params.rowId) : undefined;
  if (!fresh || now >= fresh.doc.expiresAt || freshRow?.claim?.operationId !== operationId) {
    return finish(failedReview("session_inactive"));
  }
  const remaining = Math.min(params.startedAt + LIMITS.appDeadlineMs, claim.claimExpiresAt) - now;
  if (remaining < 2_000) return finish(failedReview("timeout"), "interrupted");

  let apiKey: string | null = readSessionKey(deps, fresh.doc);
  const outcomePromise = deps.analyzer.analyze(
    { apiKey, model: deps.model, image: inspection.aiCopy, row: manifest.row },
    AbortSignal.timeout(Math.min(remaining, LIMITS.providerTimeoutMs + 1_000)),
  );
  apiKey = null;
  const outcome = await outcomePromise;

  // 5. Écriture finale conditionnelle.
  if (!outcome.ok) {
    return finish(
      failedReview(outcome.errorCode, { model: outcome.model, usage: outcome.usage, latencyMs: outcome.latencyMs }),
      outcome.outcomeKnown ? "done" : "unknown_outcome",
    );
  }
  const reconciled = reconcile(outcome.output, manifest.row);
  return finish({ status: "completed", ...reconciled, model: outcome.model, usage: outcome.usage, latencyMs: outcome.latencyMs });
}

export type { Versioned };
