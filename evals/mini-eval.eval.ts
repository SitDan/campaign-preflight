/**
 * Mini-évaluation API RÉELLE (brief §13) — locale, hors CI, plafonnée.
 * Même adaptateur, même prompt, même prétraitement que l'application.
 * Clé lue dans .env.eval.local (non versionné, propriétaire seul), jamais affichée.
 * Usage : pnpm eval
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectImage } from "@/adapters/image";
import { createOpenAiVisionAnalyzer } from "@/adapters/openai-vision";
import { reconcile } from "@/domain/ai-contract";
import { PROMPT_VERSION } from "@/domain/prompt";
import type { FindingKind, KitRow } from "@/domain/types";

type Case = { id: string; image: string; row: KitRow; expected: { findings: FindingKind[]; abstain: boolean; injectionMustBeIgnored?: boolean } };

const ENV_FILE = ".env.eval.local";
const MAX_CALLS = 8;
/** Tarif Standard lu le 2026-10-06 sur https://developers.openai.com/api/docs/pricing (gpt-6.1-sol). */
const PRICE_PER_MTOK = { "gpt-6.1-sol": { input: 2.0, output: 10.0 } } as Record<string, { input: number; output: number } | undefined>;

function loadKey(): string {
  if (!existsSync(ENV_FILE)) throw new Error(`${ENV_FILE} absent : créez-le vous-même (OPENAI_API_KEY=…), chmod 600.`);
  if ((statSync(ENV_FILE).mode & 0o077) !== 0) throw new Error(`${ENV_FILE} doit être lisible par son seul propriétaire (chmod 600).`);
  process.loadEnvFile(ENV_FILE);
  const key = process.env.OPENAI_API_KEY;
  if (!key || !key.startsWith("sk-")) throw new Error("OPENAI_API_KEY absente ou mal formée dans .env.eval.local.");
  return key;
}

describe("mini-évaluation (API réelle)", () => {
  it("exécute les six cas annotés une fois, sans relance", { timeout: 6 * 60_000 }, async () => {
    const apiKey = loadKey();
    const model = process.env.OPENAI_MODEL || "gpt-6.1-sol";
    const { cases } = JSON.parse(readFileSync("evals/cases.json", "utf8")) as { cases: Case[] };
    expect(cases.length).toBeLessThanOrEqual(MAX_CALLS);
    const analyzer = createOpenAiVisionAnalyzer();
    const results = [];
    for (const testCase of cases) {
      const inspection = await inspectImage(new Uint8Array(readFileSync(`evals/cases/${testCase.image}`)));
      if (!inspection.ok || !inspection.aiCopy) throw new Error(`prétraitement impossible : ${testCase.id}`);
      const outcome = await analyzer.analyze({ apiKey, model, image: inspection.aiCopy, row: testCase.row }, AbortSignal.timeout(45_000));
      const base = { id: testCase.id, expected: testCase.expected.findings, latencyMs: outcome.latencyMs, model: outcome.ok ? outcome.model : outcome.model ?? null, usage: outcome.usage ?? null };
      if (!outcome.ok) {
        results.push({ ...base, status: "failed", errorCode: outcome.errorCode, found: [], missed: testCase.expected.findings, falseAlerts: [], abstained: null, discarded: 0, notChecked: [], observations: [] });
        continue;
      }
      const review = reconcile(outcome.output, testCase.row);
      const found = review.findings.map((finding) => finding.kind);
      const missed = testCase.expected.findings.filter((kind) => !found.includes(kind));
      const falseAlerts = found.filter((kind) => !testCase.expected.findings.includes(kind));
      const abstained = found.length === 0 && review.notChecked.some((item) => item.check === "visible_text" || item.check === "language");
      results.push({
        ...base,
        status: "completed",
        found,
        missed,
        falseAlerts,
        abstained,
        injectionFollowed: testCase.expected.injectionMustBeIgnored ? !found.includes("offer_mismatch") : null,
        discarded: review.discarded,
        notChecked: review.notChecked,
        observations: review.observations,
        findings: review.findings,
      });
    }
    const totals = results.reduce(
      (acc, result) => ({ input: acc.input + (result.usage?.inputTokens ?? 0), output: acc.output + (result.usage?.outputTokens ?? 0), reasoning: acc.reasoning + (result.usage?.reasoningTokens ?? 0) }),
      { input: 0, output: 0, reasoning: 0 },
    );
    const price = PRICE_PER_MTOK[model];
    const estimatedUsd = price ? (totals.input * price.input + totals.output * price.output) / 1_000_000 : null;
    const summary = {
      ranAt: new Date().toISOString(),
      model,
      promptVersion: PROMPT_VERSION,
      calls: results.length,
      totals,
      estimatedUsd,
      pricingSource: price ? "https://developers.openai.com/api/docs/pricing (Standard, lu le 2026-10-06)" : "tarif inconnu : usage seulement",
      results,
    };
    mkdirSync("evals/out", { recursive: true });
    const file = `evals/out/mini-eval-${summary.ranAt.replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(summary, null, 2));
    console.table(
      results.map((result) => ({
        cas: result.id,
        attendu: result.expected.join(",") || "aucun",
        trouvé: "errorCode" in result ? `ÉCHEC ${result.errorCode}` : result.found.join(",") || "aucun",
        ratés: result.missed.join(",") || "",
        fausses_alertes: result.falseAlerts.join(",") || "",
        abstention: result.abstained ?? "",
        latence_s: (result.latencyMs / 1000).toFixed(1),
        in: result.usage?.inputTokens ?? "",
        out: result.usage?.outputTokens ?? "",
        reas: result.usage?.reasoningTokens ?? "",
      })),
    );
    console.log(`Total : ${totals.input} jetons entrée, ${totals.output} sortie (dont ${totals.reasoning} raisonnement) ; coût estimé ${estimatedUsd === null ? "inconnu" : `${estimatedUsd.toFixed(4)} $`} ; détail : ${file}`);
  });
});
