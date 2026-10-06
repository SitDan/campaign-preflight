import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectImage } from "@/adapters/image";
import type { VisionAnalyzer, VisionInput, VisionOutcome } from "@/adapters/openai-vision";
import { LIMITS } from "@/config/limits";
import { PROMPT_VERSION } from "@/domain/prompt";
import { INSTAGRAM_FEED_RULESET } from "@/domain/ruleset";
import { ServiceError } from "@/services/errors";
import { analyzeRow, createRun, type RunDeps } from "@/services/run-service";
import { authorize, createSession, getSessionStatus, readSessionKey } from "@/services/session-service";
import { DEMO_KEY, makeDeps } from "./helpers/deps";

// Faux contexte serveur (tests uniquement) pour les routes.
const harness = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/server/context", () => ({ getSessionDeps: () => harness.current }));

const code = (error: unknown) => (error instanceof ServiceError ? error.code : String(error));
const CSV = [
  "row_id,ad_name,locale,placement,media_filename,primary_text,cta,landing_url,reference_collection,reference_offer,reference_date,reference_date_label",
  "A1,Aurore FR,fr-FR,instagram_feed,a1.jpg,Texte,Acheter,https://example.com/fr,Aurore,-20 %,,",
  "B1,Aurore UK,en-GB,instagram_feed,b1.jpg,Text,Shop now,https://example.com/uk,Aurore,20% off,,",
].join("\n");
const FILES = [
  { name: "a1.jpg", size: 1 },
  { name: "b1.jpg", size: 1 },
];
const ok: VisionOutcome = {
  ok: true,
  model: "gpt-6-luna",
  latencyMs: 10,
  usage: { inputTokens: 10, outputTokens: 10, reasoningTokens: 0, cachedTokens: 0 },
  output: { observations: [], findings: [], notChecked: [] },
};

async function image() {
  return new Uint8Array(await sharp({ create: { width: 1440, height: 1800, channels: 3, background: "#ccc" } }).jpeg().toBuffer());
}

function runDeps(overrides: Partial<RunDeps> = {}) {
  const base = makeDeps();
  const calls: VisionInput[] = [];
  const analyzer: VisionAnalyzer = { analyze: async (input) => (calls.push(input), ok) };
  const deps: RunDeps = { ...base.deps, analyzer, inspect: inspectImage, model: "gpt-6-luna", ruleset: INSTAGRAM_FEED_RULESET, promptVersion: PROMPT_VERSION, ...overrides };
  return { deps, store: base.store, calls };
}

describe("clé de démonstration (choix explicite)", () => {
  it("session prête immédiatement, sans code ni clé stockée", async () => {
    const { deps, store } = makeDeps();
    const demo = await createSession(deps, { ip: null, mode: "demo" });
    expect(demo.code).toBeNull();
    expect(demo.keySource).toBe("demo");
    const status = await getSessionStatus(deps, demo.bearer);
    expect(status).toMatchObject({ state: "ready", keySource: "demo", runsLimit: LIMITS.demoRunsPerSession, aiAttemptsLimit: LIMITS.demoAiAttemptsPerSession });
    expect(store.dump()).not.toContain(DEMO_KEY);
    expect(store.dump()).not.toContain("cp:c:");
    expect(readSessionKey(deps, (await authorize(deps, demo.bearer)).doc)).toBe(DEMO_KEY);
  });

  it("refusée si la clé de démonstration est absente ou désactivée", async () => {
    const { deps } = makeDeps({ demoKey: () => null });
    await expect(createSession(deps, { ip: null, mode: "demo" }).catch(code)).resolves.toBe("demo_key_unavailable");
    const user = await createSession(deps, { ip: null });
    expect(user.code).toMatch(/^[0-9A-Z]{4}-/);
  });

  it("la session de l'utilisateur n'utilise jamais la clé de démonstration", async () => {
    const { deps } = makeDeps();
    const user = await createSession(deps, { ip: null });
    const { doc } = await authorize(deps, user.bearer);
    expect(doc.keySource).toBe("user");
    expect(() => readSessionKey(deps, doc)).toThrow(ServiceError);
  });

  it("plafonds de démonstration : validations par session et quota journalier partagé", async () => {
    const { deps, calls } = runDeps();
    const demo = await createSession(deps, { ip: null, mode: "demo" });
    for (let i = 0; i < LIMITS.demoRunsPerSession; i++) await createRun(deps, demo.bearer, { csv: CSV, files: FILES });
    await expect(createRun(deps, demo.bearer, { csv: CSV, files: FILES }).catch(code)).resolves.toBe("run_limit_reached");

    const tight = runDeps({});
    const limited: RunDeps = { ...tight.deps, abuse: { ...tight.deps.abuse, globalDemoAiAttemptsPerDay: 1 } };
    const session = await createSession(limited, { ip: null, mode: "demo" });
    const run = await createRun(limited, session.bearer, { csv: CSV, files: FILES });
    const bytes = await image();
    await analyzeRow(limited, session.bearer, { runId: run.runId, rowId: "A1", filename: "a1.jpg", bytes, startedAt: limited.now() });
    const second = await analyzeRow(limited, session.bearer, { runId: run.runId, rowId: "B1", filename: "b1.jpg", bytes, startedAt: limited.now() });
    expect(second.rows[1]?.state.ai?.errorCode).toBe("budget_exhausted");
    expect(tight.calls).toHaveLength(1);
    expect(tight.calls[0]?.apiKey).toBe(DEMO_KEY);
    expect(calls).toHaveLength(0);
  });
});

describe("routes : mode démonstration", () => {
  const APP = "http://localhost:3000";
  const WIDGET = "https://widget.example.test";

  beforeEach(() => {
    vi.stubEnv("APP_ORIGIN", APP);
    vi.stubEnv("WIDGET_ALLOWED_ORIGIN", WIDGET);
    harness.current = makeDeps().deps;
  });

  it("POST /api/sessions {mode: demo} : prête, sans code, sans clé dans la réponse", async () => {
    vi.resetModules();
    const sessions = await import("@/app/api/sessions/route");
    const response = await sessions.POST(
      new Request(`${APP}/api/sessions`, { method: "POST", headers: { origin: WIDGET, "content-type": "application/json" }, body: JSON.stringify({ mode: "demo" }) }),
    );
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ code: null, keySource: "demo" });
    expect(text).not.toContain(DEMO_KEY);
  });

  it("GET /api/config : disponibilité de la démo, jamais la clé", async () => {
    vi.stubEnv("OPENAI_DEMO_API_KEY", DEMO_KEY);
    vi.resetModules();
    const config = await import("@/app/api/config/route");
    const response = await config.GET(new Request(`${APP}/api/config`, { headers: { origin: WIDGET } }));
    const text = await response.text();
    expect(JSON.parse(text).demoKeyAvailable).toBe(true);
    expect(text).not.toContain(DEMO_KEY);
    vi.stubEnv("OPENAI_DEMO_API_KEY", "");
    vi.resetModules();
    const off = await import("@/app/api/config/route");
    expect((await (await off.GET(new Request(`${APP}/api/config`))).json()).demoKeyAvailable).toBe(false);
  });
});
