import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANARY_KEY, makeDeps } from "./helpers/deps";

// Faux contexte serveur : store mémoire, injecté uniquement dans les tests.
const harness = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/server/context", () => ({ getSessionDeps: () => harness.current }));

const APP = "http://localhost:3000";
const WIDGET = "https://widget.example.test";

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", APP);
  vi.stubEnv("WIDGET_ALLOWED_ORIGIN", WIDGET);
  harness.current = makeDeps().deps;
});

async function load() {
  vi.resetModules();
  return {
    sessions: await import("@/app/api/sessions/route"),
    session: await import("@/app/api/session/route"),
    setup: await import("@/app/api/setup/route"),
    page: await import("@/app/setup/route"),
  };
}

function setupRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/sessions", () => {
  it("refuse une origine absente, null ou inconnue, sans refléter l'origine", async () => {
    const { sessions } = await load();
    for (const origin of [undefined, "null", "https://evil.example"]) {
      const response = await sessions.POST(new Request(`${APP}/api/sessions`, { method: "POST", headers: origin ? { origin } : {} }));
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("crée une session pour l'origine exacte du composant, réponse no-store", async () => {
    const { sessions } = await load();
    const response = await sessions.POST(new Request(`${APP}/api/sessions`, { method: "POST", headers: { origin: WIDGET } }));
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe(WIDGET);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = (await response.json()) as { bearer: string; code: string };
    expect(body.bearer).toMatch(/^cps_/);
    expect(body.code).toMatch(/^[0-9A-Z]{4}-/);
  });
});

describe("POST /api/setup", () => {
  async function newCode() {
    const { sessions } = await load();
    const response = await sessions.POST(new Request(`${APP}/api/sessions`, { method: "POST", headers: { origin: WIDGET } }));
    return (await response.json()) as { bearer: string; code: string };
  }

  it("exige l'origine exacte du site et du JSON", async () => {
    const created = await newCode();
    const { setup } = await load();
    const body = { code: created.code, apiKey: CANARY_KEY };
    expect((await setup.POST(setupRequest(body, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await setup.POST(setupRequest(body, { origin: "null" }))).status).toBe(403);
    expect((await setup.POST(setupRequest(body, { origin: WIDGET }))).status).toBe(403);
    expect((await setup.POST(setupRequest(body, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    const noOrigin = new Request(`${APP}/api/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await setup.POST(noOrigin)).status).toBe(403);
    const form = new Request(`${APP}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: APP },
      body: `code=${created.code}&apiKey=${CANARY_KEY}`,
    });
    expect((await setup.POST(form)).status).toBe(415);
  });

  it("refuse un corps > 8 Kio", async () => {
    const { setup } = await load();
    const response = await setup.POST(setupRequest({ code: "x", apiKey: `sk-${"a".repeat(9000)}` }));
    expect(response.status).toBe(413);
  });

  it("dépôt valide : réponse générique, aucune trace de la clé dans réponse ni logs", async () => {
    const created = await newCode();
    const { setup, session } = await load();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")));
    const response = await setup.POST(setupRequest({ code: created.code, apiKey: CANARY_KEY }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toBe('{"ok":true}');
    const replay = await setup.POST(setupRequest({ code: created.code, apiKey: CANARY_KEY }));
    expect(replay.status).toBe(400);
    const replayText = await replay.text();
    const status = await session.GET(new Request(`${APP}/api/session`, { headers: { authorization: `Bearer ${created.bearer}`, origin: WIDGET } }));
    const statusText = await status.text();
    expect(JSON.parse(statusText).state).toBe("ready");
    for (const output of [text, replayText, statusText, ...logs]) {
      expect(output).not.toContain(CANARY_KEY);
      expect(output).not.toContain(created.code.replace(/-/g, ""));
    }
  });
});

describe("GET/DELETE /api/session", () => {
  it("bearer uniquement dans Authorization ; suppression puis accès refusé", async () => {
    const { sessions, session } = await load();
    const created = (await (await sessions.POST(new Request(`${APP}/api/sessions`, { method: "POST", headers: { origin: WIDGET } }))).json()) as { bearer: string };
    const auth = { authorization: `Bearer ${created.bearer}`, origin: WIDGET };
    expect((await session.GET(new Request(`${APP}/api/session?token=${created.bearer}`))).status).toBe(401);
    expect((await session.GET(new Request(`${APP}/api/session`, { headers: auth }))).status).toBe(200);
    expect((await session.DELETE(new Request(`${APP}/api/session`, { method: "DELETE", headers: auth }))).status).toBe(200);
    expect((await session.GET(new Request(`${APP}/api/session`, { headers: auth }))).status).toBe(401);
  });
});

describe("GET /setup", () => {
  it("CSP stricte, non intégrable, sans référent ni cache, aucun script tiers", async () => {
    const { page } = await load();
    const response = await page.GET();
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'$|script-src 'sha256-[A-Za-z0-9+/=]+';/);
    expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const html = await response.text();
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="off"');
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});
