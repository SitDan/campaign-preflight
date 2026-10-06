import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectImage } from "@/adapters/image";
import { LIMITS } from "@/config/limits";
import type { VisionAnalyzer, VisionInput, VisionOutcome } from "@/adapters/openai-vision";
import { PROMPT_VERSION } from "@/domain/prompt";
import { buildReport, toExportCsv } from "@/domain/report";
import { INSTAGRAM_FEED_RULESET } from "@/domain/ruleset";
import { ServiceError } from "@/services/errors";
import { analyzeRow, createRun, getRun, type RunDeps } from "@/services/run-service";
import { createSession, deleteSession, depositKey } from "@/services/session-service";
import { CANARY_KEY, makeDeps } from "./helpers/deps";

const HEADER = "row_id,ad_name,locale,placement,media_filename,primary_text,cta,landing_url,reference_collection,reference_offer,reference_date,reference_date_label";
const CSV = [
  HEADER,
  "A1,Aurore FR,fr-FR,instagram_feed,a1.jpg,Découvrez Aurore,Acheter,https://example.com/fr,Aurore,-20 %,2026-11-30,fin de l'offre",
  "B1,Aurore UK,en-GB,instagram_feed,b1.jpg,Discover Aurore,Shop now,https://example.com/uk,Aurore,-20 %,2026-11-30,end of offer",
  "C1,Aurore DE,de-DE,instagram_feed,,Entdecken,Jetzt kaufen,https://example.com/de,Aurore,,,",
].join("\n");
const FILES = [
  { name: "a1.jpg", size: 1 },
  { name: "b1.jpg", size: 1 },
];

const okOutput: VisionOutcome = {
  ok: true,
  model: "gpt-6.1-sol",
  latencyMs: 1200,
  usage: { inputTokens: 1500, outputTokens: 300, reasoningTokens: 100, cachedTokens: 0 },
  output: {
    observations: [{ text: "-30 % sur Aurore", legibility: "legible", language: "fr" }],
    findings: [
      { kind: "offer_mismatch", observedText: "-30 %", referenceField: "reference_offer", explanation: "Le visuel annonce -30 %.", action: "Remplacer par -20 %." },
      { kind: "collection_mismatch", observedText: "Aurore", referenceField: "reference_offer", explanation: "Champ incohérent", action: "—" },
    ],
    notChecked: [{ check: "date", reason: "Aucune date visible." }],
  },
};

function fakeAnalyzer(behaviour: (input: VisionInput, signal: AbortSignal) => Promise<VisionOutcome> = async () => okOutput) {
  const calls: VisionInput[] = [];
  const analyzer: VisionAnalyzer = {
    async analyze(input, signal) {
      calls.push(input);
      return behaviour(input, signal);
    },
  };
  return { analyzer, calls };
}

async function image() {
  return new Uint8Array(await sharp({ create: { width: 1440, height: 1800, channels: 3, background: "#d0a070" } }).jpeg().toBuffer());
}

async function setup(analyzer: VisionAnalyzer, overrides: Partial<RunDeps> = {}) {
  const base = makeDeps();
  const deps: RunDeps = {
    ...base.deps,
    analyzer,
    inspect: inspectImage,
    model: "gpt-6.1-sol",
    ruleset: INSTAGRAM_FEED_RULESET,
    promptVersion: PROMPT_VERSION,
    ...overrides,
  };
  const session = await createSession(deps, { ip: null });
  await depositKey(deps, { code: session.code, apiKey: CANARY_KEY, ip: null });
  const run = await createRun(deps, session.bearer, { csv: CSV, files: FILES });
  return { deps, store: base.store, clock: base.clock, bearer: session.bearer, run };
}

const errorCode = (error: unknown) => (error instanceof ServiceError ? error.code : String(error));

describe("validation et analyse", () => {
  it("crée un run figé (règles, prompt, modèle) ; ligne incomplète en anomalie sans IA", async () => {
    const { run } = await setup(fakeAnalyzer().analyzer);
    expect(run.rulesetVersion).toBe(INSTAGRAM_FEED_RULESET.version);
    expect(run.promptVersion).toBe(PROMPT_VERSION);
    expect(run.rows.map((row) => row.state.phase)).toEqual(["awaiting_media", "awaiting_media", "row_error"]);
  });

  it("analyse une ligne : mesures + IA ; constats rattachés par le serveur ; clé déchiffrée seulement pour l'appel", async () => {
    const fake = fakeAnalyzer();
    const { deps, bearer, run, store } = await setup(fake.analyzer);
    const view = await analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes: await image(), startedAt: deps.now() });
    const row = view.rows.find((item) => item.row.rowId === "A1")!;
    expect(row.state.phase).toBe("done");
    expect(row.state.facts).toMatchObject({ width: 1440, height: 1800, format: "jpeg" });
    expect(row.state.technical?.find((check) => check.ruleId === "meta.req.aspect_ratio")?.status).toBe("pass");
    expect(row.state.ai?.status).toBe("completed");
    expect(row.state.ai?.findings).toHaveLength(1);
    expect(row.state.ai?.findings[0]?.expected).toBe("-20 %");
    expect(row.state.ai?.discarded).toBe(1);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.apiKey).toBe(CANARY_KEY);
    expect(fake.calls[0]?.image.mimeType).toBe("image/jpeg");
    expect(store.dump()).not.toContain(CANARY_KEY);
    const report = buildReport(view, INSTAGRAM_FEED_RULESET, deps.now());
    const exported = toExportCsv(report);
    expect(JSON.stringify(report) + exported).not.toContain(CANARY_KEY);
    expect(JSON.stringify(report) + exported).not.toContain(bearer);
    expect(exported).toContain('"ai_alert","to_confirm","ai.offer_mismatch"');
  });

  it("double clic : un seul appel IA ; après achèvement, résultat existant sans nouvel appel", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeAnalyzer(async () => {
      await gate;
      return okOutput;
    });
    const { deps, bearer, run } = await setup(fake.analyzer);
    const bytes = await image();
    const first = analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes, startedAt: deps.now() });
    for (let waited = 0; fake.calls.length === 0 && waited < 5000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.calls).toHaveLength(1);
    const second = await analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes, startedAt: deps.now() }).catch(errorCode);
    expect(second).toBe("operation_in_progress");
    const other = await analyzeRow(deps, bearer, { runId: run.runId, rowId: "B1", filename: "b1.jpg", bytes, startedAt: deps.now() }).catch(errorCode);
    expect(other).toBe("operation_in_progress");
    release();
    await first;
    const again = await analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes, startedAt: deps.now() });
    expect(again.rows[0]?.state.ai?.status).toBe("completed");
    expect(fake.calls).toHaveLength(1);
  });

  it("erreur IA : mesures conservées, aucune relance automatique ; issue inconnue signalée", async () => {
    const fake = fakeAnalyzer(async () => ({ ok: false, errorCode: "timeout", outcomeKnown: false, latencyMs: 30_000 }));
    const { deps, bearer, run } = await setup(fake.analyzer);
    const view = await analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes: await image(), startedAt: deps.now() });
    const row = view.rows[0]!;
    expect(row.state.phase).toBe("unknown_outcome");
    expect(row.state.ai?.errorCode).toBe("timeout");
    expect(row.state.technical?.length).toBeGreaterThan(0);
    expect(row.state.facts?.width).toBe(1440);
    await analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes: await image(), startedAt: deps.now() });
    expect(fake.calls).toHaveLength(1);
  });

  it.each(["refusal", "incomplete", "invalid_output", "invalid_key", "model_unavailable", "quota_exceeded"] as const)("échec %s : revue non achevée, rapport technique visible", async (code) => {
    const fake = fakeAnalyzer(async () => ({ ok: false, errorCode: code, outcomeKnown: true, latencyMs: 10 }));
    const { deps, bearer, run } = await setup(fake.analyzer);
    const view = await analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes: await image(), startedAt: deps.now() });
    expect(view.rows[0]?.state.ai).toMatchObject({ status: "failed", errorCode: code });
    expect(view.rows[0]?.state.phase).toBe("done");
    expect(view.rows[0]?.state.technical?.some((check) => check.status === "pass")).toBe(true);
  });

  it("image refusée : mesures et règles visibles, aucun appel IA", async () => {
    const fake = fakeAnalyzer();
    const { deps, bearer, run } = await setup(fake.analyzer);
    const gif = new Uint8Array(await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).gif().toBuffer());
    const view = await analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes: gif, startedAt: deps.now() });
    expect(view.rows[0]?.state.mediaError).toBe("unsupported_format");
    expect(view.rows[0]?.state.ai?.errorCode).toBe("image_not_analyzable");
    expect(fake.calls).toHaveLength(0);
  });

  it("refuse un fichier dont le nom diffère, une ligne non éligible, un run d'une autre session", async () => {
    const { deps, bearer, run } = await setup(fakeAnalyzer().analyzer);
    const bytes = await image();
    await expect(analyzeRow(deps, bearer, { runId: run.runId, rowId: "A1", filename: "autre.jpg", bytes, startedAt: deps.now() }).catch(errorCode)).resolves.toBe("invalid_request");
    await expect(analyzeRow(deps, bearer, { runId: run.runId, rowId: "C1", filename: "", bytes, startedAt: deps.now() }).catch(errorCode)).resolves.toBe("row_not_eligible");
    const other = await createSession(deps, { ip: null });
    await depositKey(deps, { code: other.code, apiKey: "sk-other-session-key-00000000", ip: null });
    await expect(getRun(deps, other.bearer, run.runId).catch(errorCode)).resolves.toBe("run_not_found");
    await expect(analyzeRow(deps, other.bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes, startedAt: deps.now() }).catch(errorCode)).resolves.toBe("run_not_found");
  });

  it("plafonds : validations par session, tentatives IA, plafond global concurrent", async () => {
    const fake = fakeAnalyzer();
    const { deps, bearer } = await setup(fake.analyzer);
    for (let i = 1; i < LIMITS.runsPerSession; i++) await createRun(deps, bearer, { csv: CSV, files: FILES });
    await expect(createRun(deps, bearer, { csv: CSV, files: FILES }).catch(errorCode)).resolves.toBe("run_limit_reached");

    const limited = fakeAnalyzer();
    const ctx = await setup(limited.analyzer);
    const tight: RunDeps = { ...ctx.deps, abuse: { ...ctx.deps.abuse, globalAiAttemptsPerDay: 1 } };
    const bytes = await image();
    await analyzeRow(tight, ctx.bearer, { runId: ctx.run.runId, rowId: "A1", filename: "a1.jpg", bytes, startedAt: tight.now() });
    const second = await analyzeRow(tight, ctx.bearer, { runId: ctx.run.runId, rowId: "B1", filename: "b1.jpg", bytes, startedAt: tight.now() });
    expect(second.rows[1]?.state.ai?.errorCode).toBe("budget_exhausted");
    expect(second.rows[1]?.state.technical?.length).toBeGreaterThan(0);
    expect(limited.calls).toHaveLength(1);
  });

  it("suppression pendant l'appel IA : écriture finale refusée, session non recréée", async () => {
    const holder: { ctx?: Awaited<ReturnType<typeof setup>> } = {};
    const fake = fakeAnalyzer(async () => {
      await deleteSession(holder.ctx!.deps, holder.ctx!.bearer);
      return okOutput;
    });
    const ctx = (holder.ctx = await setup(fake.analyzer));
    const result = await analyzeRow(ctx.deps, ctx.bearer, { runId: ctx.run.runId, rowId: "A1", filename: "a1.jpg", bytes: await image(), startedAt: ctx.deps.now() }).catch(errorCode);
    expect(result).toBe("session_invalid");
    expect(ctx.store.dump()).not.toContain(ctx.run.runId);
  });

  it("claim expiré pendant l'appel : résultat écarté, ligne interrompue constatée par le GET", async () => {
    const holder: { ctx?: Awaited<ReturnType<typeof setup>> } = {};
    const fake = fakeAnalyzer(async () => {
      holder.ctx!.clock.advance(80_000);
      return okOutput;
    });
    const ctx = (holder.ctx = await setup(fake.analyzer));
    const view = await analyzeRow(ctx.deps, ctx.bearer, { runId: ctx.run.runId, rowId: "A1", filename: "a1.jpg", bytes: await image(), startedAt: ctx.deps.now() });
    expect(view.rows[0]?.state.phase).toBe("interrupted");
    expect(view.rows[0]?.state.ai).toBeNull();
    expect(view.rows[0]?.state.technical?.length).toBeGreaterThan(0);
  });
});
