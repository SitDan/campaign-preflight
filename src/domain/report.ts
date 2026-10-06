import { LIMITS } from "@/config/limits";
import { describeCoverage, type CheckResult, type Coverage, type Ruleset } from "./rules";
import type { AiErrorCode, AiReview, KitRow, RowIssue, RowState } from "./types";

/**
 * Rapport versionné : mesures certaines, alertes IA « à confirmer »
 * et contrôles non effectués, sans média brut ni secret. Fonctions pures.
 */
export const REPORT_SCHEMA = "campaign-preflight.report/v1";

export type ReportInput = {
  runId: string;
  createdAt: number;
  rulesetId: string;
  rulesetVersion: string;
  promptVersion: string;
  model: string;
  warnings: string[];
  rows: Array<{ line: number; row: KitRow; issues: RowIssue[]; eligible: boolean; state: RowState }>;
};

export type ReportRow = {
  line: number;
  rowId: string;
  adName: string;
  locale: string;
  placement: string;
  mediaFilename: string;
  phase: RowState["phase"];
  kitIssues: RowIssue[];
  mediaError: RowState["mediaError"];
  facts: RowState["facts"];
  technical: CheckResult[];
  ai: AiReview | null;
};

export type Report = {
  schema: typeof REPORT_SCHEMA;
  runId: string;
  createdAt: string;
  generatedAt: string;
  rulesetId: string;
  rulesetVersion: string;
  promptVersion: string;
  model: string;
  coverage: Coverage;
  warnings: string[];
  summary: {
    ads: number;
    processed: number;
    technicalErrors: number;
    recommendationGaps: number;
    kitIssues: number;
    aiAlerts: number;
    aiNotCompleted: number;
    notChecked: number;
  };
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; calls: number };
  rows: ReportRow[];
};

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  invalid_key: "Clé OpenAI refusée (invalide ou révoquée).",
  model_unavailable: "Modèle inaccessible avec cette clé.",
  quota_exceeded: "Quota ou crédit API OpenAI épuisé.",
  rate_limited: "Limite de débit OpenAI atteinte.",
  timeout: "Délai dépassé : revue non achevée (un coût a pu être facturé).",
  refusal: "Le modèle a refusé de répondre.",
  incomplete: "Réponse du modèle incomplète.",
  invalid_output: "Réponse du modèle hors contrat.",
  provider_error: "Erreur du fournisseur IA.",
  network_error: "Erreur réseau vers OpenAI : issue inconnue (un coût a pu être facturé).",
  session_inactive: "Session supprimée ou expirée avant l'envoi.",
  budget_exhausted: "Plafond de tentatives IA atteint.",
  image_not_analyzable: "Image non analysable par l'IA.",
};

export function buildReport(input: ReportInput, ruleset: Ruleset, now: number): Report {
  const rows: ReportRow[] = input.rows.map(({ line, row, issues, state }) => ({
    line,
    rowId: row.rowId,
    adName: row.adName,
    locale: row.locale,
    placement: row.placement,
    mediaFilename: row.mediaFilename,
    phase: state.phase,
    kitIssues: issues,
    mediaError: state.mediaError,
    facts: state.facts,
    technical: state.technical ?? [],
    ai: state.ai,
  }));
  const technical = rows.flatMap((row) => row.technical);
  const usage = rows.reduce(
    (total, row) => {
      if (!row.ai?.usage) return total;
      return {
        inputTokens: total.inputTokens + row.ai.usage.inputTokens,
        outputTokens: total.outputTokens + row.ai.usage.outputTokens,
        reasoningTokens: total.reasoningTokens + row.ai.usage.reasoningTokens,
        calls: total.calls + 1,
      };
    },
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, calls: 0 },
  );
  const report: Report = {
    schema: REPORT_SCHEMA,
    runId: input.runId,
    createdAt: new Date(input.createdAt).toISOString(),
    generatedAt: new Date(now).toISOString(),
    rulesetId: input.rulesetId,
    rulesetVersion: input.rulesetVersion,
    promptVersion: input.promptVersion,
    model: input.model,
    coverage: describeCoverage(ruleset),
    warnings: input.warnings,
    summary: {
      ads: rows.length,
      processed: rows.filter((row) => row.phase === "done").length,
      technicalErrors: technical.filter((check) => check.status === "fail" && check.origin !== "meta_recommendation").length,
      recommendationGaps: technical.filter((check) => check.status === "fail" && check.origin === "meta_recommendation").length,
      kitIssues: rows.reduce((total, row) => total + row.kitIssues.length, 0),
      aiAlerts: rows.reduce((total, row) => total + (row.ai?.findings.length ?? 0), 0),
      aiNotCompleted: rows.filter((row) => row.ai && row.ai.status !== "completed").length,
      notChecked: technical.filter((check) => check.status === "not_checked").length + rows.reduce((total, row) => total + (row.ai?.notChecked.length ?? 0), 0),
    },
    usage,
    rows,
  };
  const size = new TextEncoder().encode(JSON.stringify(report)).byteLength;
  if (size > LIMITS.reportMaxBytes) throw new ReportTooLargeError();
  return report;
}

export class ReportTooLargeError extends Error {
  readonly code = "report_too_large";
}

// ---------- Export CSV ----------

export const EXPORT_COLUMNS = ["row_id", "ad_name", "locale", "placement", "origin", "status", "rule_id", "observed", "expected", "action", "source_url"] as const;

/** Neutralise les formules tableur, y compris derrière espaces/contrôles initiaux. */
export function neutralizeCell(value: string): string {
   
  return /^[\s\u0000-\u001f]*[=+\-@\u0009\u000d]/.test(value) || /^[\u0009\u000d]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: string): string {
  const safe = neutralizeCell(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

const STATUS_LABEL: Record<string, string> = {
  pass: "pass",
  fail: "fail",
  not_checked: "not_checked",
  not_applicable: "not_applicable",
  to_confirm: "to_confirm",
};

export function toExportCsv(report: Report): string {
  const lines: string[][] = [];
  for (const row of report.rows) {
    const base = [row.rowId, row.adName, row.locale, row.placement];
    for (const issue of row.kitIssues) {
      lines.push([...base, "kit_contract", "fail", `kit.${issue.field}.${issue.code}`, "", issue.message, "Corriger la ligne du kit avant transmission.", ""]);
    }
    if (row.mediaError) {
      lines.push([...base, "media", "fail", `media.${row.mediaError}`, row.mediaFilename, "JPEG/PNG statique lisible dans les limites du POC", "Fournir une image valide.", ""]);
    }
    for (const check of row.technical) {
      lines.push([...base, check.origin, STATUS_LABEL[check.status] ?? check.status, check.ruleId, check.observed, check.expected, check.status === "pass" ? "" : check.action, check.sourceUrl ?? ""]);
    }
    if (row.ai) {
      if (row.ai.status !== "completed") {
        lines.push([...base, "ai", "not_checked", "ai.review", row.ai.errorCode ?? "", "", row.ai.errorCode ? AI_ERROR_MESSAGES[row.ai.errorCode] : "", ""]);
      }
      for (const finding of row.ai.findings) {
        lines.push([...base, "ai_alert", "to_confirm", `ai.${finding.kind}`, finding.observedText, finding.expected, finding.action, ""]);
      }
      for (const item of row.ai.notChecked) {
        lines.push([...base, "ai", "not_checked", `ai.${item.check}`, "", "", item.reason, ""]);
      }
    } else if (row.phase !== "row_error") {
      lines.push([...base, "processing", "not_checked", "row.processing", row.phase, "", "Analyse non effectuée pour cette annonce.", ""]);
    }
  }
  const csv = [EXPORT_COLUMNS.map(csvCell).join(","), ...lines.map((line) => line.map(csvCell).join(","))].join("\r\n") + "\r\n";
  if (new TextEncoder().encode(csv).byteLength > LIMITS.reportMaxBytes) throw new ReportTooLargeError();
  return csv;
}

// ---------- Résumé partageable (sans secret, URL ni identifiant de session) ----------

// ---------- Verdict par annonce (partagé par le composant et le résumé) ----------

export type RowVerdict = "to_fix" | "to_check" | "incomplete" | "not_analyzed" | "clear";

export const VERDICT_LABEL: Record<RowVerdict, string> = {
  to_fix: "À corriger",
  to_check: "À vérifier",
  incomplete: "Vérification incomplète",
  not_analyzed: "Non vérifiée",
  clear: "Rien à signaler",
};

export function rowVerdict(row: ReportRow): RowVerdict {
  const blocking = row.kitIssues.length > 0 || row.mediaError !== null || row.technical.some((check) => check.status === "fail" && check.origin !== "meta_recommendation");
  if (blocking) return "to_fix";
  if (row.phase === "awaiting_media") return "not_analyzed";
  if (row.phase === "interrupted" || row.phase === "unknown_outcome" || (row.ai && row.ai.status !== "completed")) return "incomplete";
  if ((row.ai?.findings.length ?? 0) > 0 || row.technical.some((check) => check.status === "fail")) return "to_check";
  return "clear";
}

/**
 * Résumé partageable : commence par le verdict par annonce (comme le composant),
 * pour qu'aucun lecteur — humain ou modèle — ne conclue « kit propre » à tort.
 */
export function toSummaryText(report: Report): string {
  const verdicts = report.rows.map(rowVerdict);
  const count = (verdict: RowVerdict) => verdicts.filter((item) => item === verdict).length;
  const parts = (["to_fix", "to_check", "incomplete", "not_analyzed", "clear"] as RowVerdict[])
    .filter((verdict) => count(verdict) > 0)
    .map((verdict) => `${count(verdict)} « ${VERDICT_LABEL[verdict]} »`);
  const needsAction = count("to_fix") + count("to_check") + count("incomplete") + count("not_analyzed") > 0;
  const out: string[] = [
    `Résultat de la vérification Campaign Preflight (Instagram Feed) — ${report.rows.length} annonce(s) : ${parts.join(", ")}.`,
    needsAction
      ? "Le kit n'est PAS prêt à être publié en l'état : les annonces « À corriger » et « À vérifier » doivent être traitées avant l'envoi."
      : "Aucun problème repéré sur les points vérifiés.",
    "Légende : « À corriger » = écart certain (format, règle Meta, champ manquant) ; « À vérifier » = différence repérée par l'IA entre le texte du visuel et les informations du kit (langue, offre, collection, date), à confirmer par une personne mais à traiter avant publication.",
  ];
  for (const [index, row] of report.rows.entries()) {
    out.push(`\n• ${row.adName} (${row.rowId}, ${row.locale}) : ${VERDICT_LABEL[verdicts[index] as RowVerdict]}`);
    for (const issue of row.kitIssues) out.push(`  - Champ du kit (${issue.field}) : ${issue.message}`);
    if (row.mediaError) out.push(`  - Image refusée : ${row.mediaError}`);
    for (const check of row.technical.filter((item) => item.status === "fail")) {
      const kind = check.origin === "meta_requirement" ? "Exigence Meta" : check.origin === "meta_recommendation" ? "Recommandation Meta" : "Limite du POC";
      out.push(`  - ${kind} non respectée : ${check.label} — observé ${check.observed}, attendu ${check.expected}. Correction : ${check.action}`);
    }
    for (const finding of row.ai?.findings ?? []) {
      out.push(`  - Différence repérée par l'IA (${finding.kind}) : « ${finding.observedText} » au lieu de « ${finding.expected} ». ${finding.explanation} Correction : ${finding.action}`);
    }
    if (row.ai && row.ai.status !== "completed" && row.ai.errorCode) out.push(`  - Lecture des textes non effectuée : ${AI_ERROR_MESSAGES[row.ai.errorCode]}`);
    for (const item of row.ai?.notChecked ?? []) out.push(`  - Non vérifié (${item.check}) : ${item.reason}`);
  }
  out.push("\nLes limites du POC ne sont pas des règles Meta.");
  return out.join("\n").slice(0, 8000);
}
