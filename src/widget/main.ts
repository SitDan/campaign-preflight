import { LIMITS } from "@/config/limits";
import { CSV_TEMPLATE, parseKit, type ImportResult } from "@/domain/kit";
import { AI_ERROR_MESSAGES, toSummaryText, type Report, type ReportRow } from "@/domain/report";
import type { CheckResult } from "@/domain/rules";
import { createApi, forgetSession, hasSession } from "./api";
import { formatBytes, h, replace } from "./dom";
import { connectHost, downloadText, hostInfo, openExternal, sendChatMessage } from "./host";

type WidgetConfig = { apiBase: string };

function readConfig(): WidgetConfig {
  const node = document.getElementById("cp-config");
  const parsed = JSON.parse(node?.textContent ?? "{}") as Partial<WidgetConfig>;
  return { apiBase: typeof parsed.apiBase === "string" ? parsed.apiBase : "" };
}

const config = readConfig();
const api = createApi(config.apiBase);
const root = document.getElementById("app") as HTMLElement;
const SETUP_URL = `${config.apiBase}/setup`;

type Phase = "intro" | "pending" | "ready";

const state = {
  phase: "intro" as Phase,
  code: null as string | null,
  codeExpiresAt: 0,
  expiresAt: 0,
  busy: false,
  notice: "",
  error: "",
  setupFallback: false,
  csvName: "",
  csvText: "",
  images: new Map<string, File>(),
  thumbs: new Map<string, string>(),
  preview: null as ImportResult | null,
  importErrors: [] as string[],
  report: null as Report | null,
  progress: [] as string[],
  exportText: "",
  exportNote: "",
  summaryText: "",
  diagnostics: "",
};

// ---------- utilitaires ----------

const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function setBusy(busy: boolean, notice = "") {
  state.busy = busy;
  state.notice = notice;
  if (busy) state.error = "";
  render();
}

function fail(message: string) {
  state.busy = false;
  state.error = message;
  render();
}

function revokeThumbs() {
  for (const url of state.thumbs.values()) URL.revokeObjectURL(url);
  state.thumbs.clear();
}

function resetKit() {
  revokeThumbs();
  state.csvName = "";
  state.csvText = "";
  state.images = new Map();
  state.preview = null;
  state.importErrors = [];
  state.report = null;
  state.progress = [];
  state.exportText = "";
  state.summaryText = "";
}

function updatePreview() {
  state.importErrors = [];
  state.preview = state.csvText ? parseKit(state.csvText, [...state.images.values()].map((file) => ({ name: file.name, size: file.size }))) : null;
}

function setImages(files: File[]) {
  revokeThumbs();
  state.images = new Map(files.map((file) => [file.name, file]));
  for (const file of files) state.thumbs.set(file.name, URL.createObjectURL(file));
  updatePreview();
}

// ---------- actions ----------

async function configure() {
  setBusy(true, "Création d'une session temporaire…");
  const result = await api.createSession();
  if (!result.ok) return fail(result.message);
  state.code = result.data.code;
  state.codeExpiresAt = result.data.codeExpiresAt;
  state.expiresAt = result.data.expiresAt;
  state.phase = "pending";
  state.setupFallback = false;
  setBusy(false);
}

async function openSetup() {
  const via = await openExternal(SETUP_URL);
  state.setupFallback = !via;
  render();
}

async function verify() {
  setBusy(true, "Vérification…");
  const result = await api.getSession();
  if (!result.ok) {
    forgetSession();
    state.phase = "intro";
    state.code = null;
    return fail(`${result.message} Un rechargement du composant impose aussi une nouvelle session.`);
  }
  state.expiresAt = result.data.expiresAt;
  if (result.data.state === "ready") {
    state.phase = "ready";
    state.code = null;
    setBusy(false, "Clé enregistrée pour cette session. Elle n'a pas été testée auprès d'OpenAI : la première analyse vérifiera l'accès au modèle.");
    return;
  }
  setBusy(false);
  state.error = result.data.codeActive
    ? "Aucune clé associée pour l'instant. Terminez la saisie sur la page externe puis vérifiez à nouveau."
    : "Le code a expiré (10 minutes). Terminez cette session et recommencez.";
  render();
}

async function finish() {
  setBusy(true, "Suppression…");
  const result = hasSession() ? await api.deleteSession() : null;
  forgetSession();
  resetKit();
  state.phase = "intro";
  state.code = null;
  state.busy = false;
  state.notice =
    result && !result.ok
      ? `Session déjà inactive côté serveur (${result.message}).`
      : "Session supprimée : clé chiffrée et résultats retirés de notre stockage actif. La clé reste valide chez OpenAI : révoquez-la depuis votre compte si nécessaire.";
  render();
}

async function loadDemo() {
  setBusy(true, "Chargement du kit fictif…");
  const files = await Promise.all([
    api.demoFile("kit.csv", "text/csv"),
    api.demoFile("aurore-fr.jpg", "image/jpeg"),
    api.demoFile("aurore-uk.jpg", "image/jpeg"),
    api.demoFile("aurore-de.png", "image/png"),
  ]);
  if (files.some((file) => !file)) return fail("Kit fictif indisponible depuis le composant.");
  const [csv, ...images] = files as File[];
  resetKit();
  state.csvName = csv!.name;
  state.csvText = await csv!.text();
  setImages(images);
  setBusy(false, "Kit fictif chargé : 3 annonces Instagram Feed de la collection « Aurore ».");
}

async function onCsv(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > LIMITS.csvMaxBytes) return fail("CSV de plus de 64 Kio : non pris en charge par ce POC.");
  state.report = null;
  state.csvName = file.name;
  state.csvText = await file.text();
  updatePreview();
  render();
}

function onImages(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files ?? []);
  state.report = null;
  setImages(files);
  render();
}

async function analyze() {
  const preview = state.preview;
  if (!preview?.ok) return;
  state.progress = [];
  state.exportText = "";
  state.summaryText = "";
  setBusy(true, "Envoi du CSV…");
  const created = await api.createRun(state.csvText, [...state.images.values()].map((file) => ({ name: file.name, size: file.size })));
  if (!created.ok) {
    state.importErrors = Array.isArray(created.details?.errors) ? (created.details.errors as string[]) : [];
    return fail(created.message);
  }
  state.report = created.data;
  const pending = created.data.rows.filter((row) => row.phase === "awaiting_media");
  for (const [index, row] of pending.entries()) {
    const file = state.images.get(row.mediaFilename);
    if (!file) continue;
    state.progress.push(`Annonce ${index + 1}/${pending.length} — « ${row.adName} » : envoi de l'image et analyse…`);
    render();
    let result = await api.analyzeRow(created.data.runId, row.rowId, file);
    if (!result.ok && result.code === "operation_in_progress") {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      result = await api.getRun(created.data.runId);
    }
    if (!result.ok) {
      state.progress.push(`Annonce « ${row.adName} » : ${result.message}`);
      if (result.status === 401) {
        forgetSession();
        state.phase = "intro";
        return fail(`${result.message} Les résultats déjà affichés restent visibles ci-dessous.`);
      }
      continue;
    }
    state.report = result.data;
    const done = result.data.rows.find((item) => item.rowId === row.rowId);
    state.progress.push(`Annonce « ${row.adName} » : ${done?.ai?.status === "completed" ? "terminée" : done?.ai?.errorCode ? `mesures faites, ${AI_ERROR_MESSAGES[done.ai.errorCode].toLowerCase()}` : `état ${done?.phase ?? "inconnu"}`}.`);
    render();
  }
  setBusy(false, "Analyse terminée.");
}

async function exportCsv() {
  if (!state.report) return;
  setBusy(true, "Préparation de l'export…");
  const result = await api.exportCsv(state.report.runId);
  if (!result.ok) return fail(result.message);
  const downloaded = await downloadText("campaign-preflight-rapport.csv", "text/csv", result.data);
  state.exportText = downloaded ? "" : result.data;
  state.exportNote = downloaded
    ? "Téléchargement demandé à l'hôte."
    : "Téléchargement indisponible dans cet hôte : sélectionnez tout le texte ci-dessous et enregistrez-le dans un fichier .csv (UTF-8).";
  setBusy(false);
}

async function explain() {
  if (!state.report) return;
  const summary = toSummaryText(state.report);
  const sent = await sendChatMessage(summary);
  state.summaryText = sent ? "" : summary;
  state.notice = sent ? "Résumé nettoyé envoyé dans la conversation." : "Envoi indisponible : copiez le résumé ci-dessous dans la conversation.";
  render();
}

async function downloadTemplate() {
  const ok = await downloadText("campaign-preflight-modele.csv", "text/csv", CSV_TEMPLATE);
  state.exportText = ok ? "" : CSV_TEMPLATE;
  state.exportNote = ok ? "Modèle demandé à l'hôte." : "Téléchargement indisponible : copiez ce modèle dans un fichier .csv.";
  render();
}

async function testService() {
  const rules = await api.getRules();
  state.diagnostics = rules.ok ? `Service joignable — référentiel ${rules.data.rulesetVersion}, ${rules.data.metaRules.length} règles Meta.` : `Échec : ${rules.message}`;
  render();
}

// ---------- rendu ----------

function steps() {
  const current = state.report ? 3 : state.phase === "ready" ? (state.preview ? 2 : 1) : 0;
  return h(
    "ol",
    { className: "steps" },
    ...["Configuration", "Kit", "Analyse", "Rapport"].map((label, index) => h("li", { className: index === current ? "current" : index < current ? "done" : "" }, `${index + 1}. ${label}`)),
  );
}

function configSection() {
  if (state.phase === "intro") {
    return h(
      "section",
      { className: "card" },
      h("h2", {}, "1. Configuration de votre clé OpenAI"),
      h("p", {}, "Périmètre : images JPEG/PNG statiques, Instagram Feed, 3 annonces maximum (fr-FR, en-GB, de-DE)."),
      h("p", { className: "muted" }, "Les analyses IA utilisent VOTRE clé API OpenAI, facturée séparément de votre abonnement ChatGPT. La clé se saisit sur une page externe, jamais dans la conversation ni dans ce composant."),
      h("div", { className: "actions" }, h("button", { type: "button", className: "primary", onclick: configure, disabled: state.busy }, "Configurer ma clé")),
    );
  }
  if (state.phase === "pending") {
    return h(
      "section",
      { className: "card" },
      h("h2", {}, "1. Associer votre clé à cette session"),
      h("p", {}, "Code d'association de CE composant (usage unique, valable jusqu'à ", time(state.codeExpiresAt), ") :"),
      h("div", { className: "code", "aria-label": "Code d'association" }, state.code ?? ""),
      h("p", { className: "muted" }, "Ouvrez la page externe, saisissez ce code et votre clé, puis revenez ici. Ne collez jamais ce code ni votre clé dans la conversation."),
      h(
        "div",
        { className: "actions" },
        h("button", { type: "button", onclick: openSetup }, "Ouvrir la page de configuration"),
        h("button", { type: "button", className: "primary", onclick: verify, disabled: state.busy }, "Vérifier la connexion"),
        h("button", { type: "button", onclick: finish, disabled: state.busy }, "Annuler"),
      ),
      state.setupFallback ? h("p", {}, "Ouverture automatique indisponible : ouvrez manuellement ", h("span", { className: "code-inline" }, SETUP_URL)) : null,
      h("p", { className: "muted" }, "Si ce composant est rechargé, la session est perdue : il faudra recommencer (aucune persistance navigateur)."),
    );
  }
  return h(
    "section",
    { className: "card" },
    h("h2", {}, "1. Configuration"),
    h("p", {}, `Clé associée à cette session (non testée auprès d'OpenAI). Expiration absolue : ${time(state.expiresAt)}.`),
    h("div", { className: "actions" }, h("button", { type: "button", onclick: finish, disabled: state.busy }, "Terminer et supprimer")),
  );
}

function kitSection() {
  const preview = state.preview;
  const rows = preview?.ok ? preview.manifest.rows : [];
  return h(
    "section",
    { className: "card" },
    h("h2", {}, "2. Kit (CSV imposé + images)"),
    h(
      "div",
      { className: "actions" },
      h("button", { type: "button", onclick: loadDemo, disabled: state.busy }, "Charger le kit fictif"),
      h("button", { type: "button", onclick: downloadTemplate }, "Modèle CSV"),
    ),
    h("label", { className: "file" }, "CSV : ", h("input", { type: "file", accept: ".csv,text/csv", onchange: onCsv, disabled: state.busy })),
    h("label", { className: "file" }, " Images (3 max) : ", h("input", { type: "file", accept: ".jpg,.jpeg,.png,image/jpeg,image/png", multiple: true, onchange: onImages, disabled: state.busy })),
    state.csvName ? h("p", { className: "muted" }, `CSV : ${state.csvName} · images : ${[...state.images.keys()].join(", ") || "aucune"}`) : null,
    preview && !preview.ok ? h("div", { className: "error" }, h("strong", {}, "Import à corriger : "), ...preview.errors.map((error) => h("div", {}, error))) : null,
    preview?.ok
      ? h(
          "table",
          {},
          h("tr", {}, h("th", {}, ""), h("th", {}, "Annonce"), h("th", {}, "Locale"), h("th", {}, "Image"), h("th", {}, "État")),
          ...rows.map((item) =>
            h(
              "tr",
              {},
              h("td", {}, state.thumbs.get(item.row.mediaFilename) ? h("img", { className: "thumb", src: state.thumbs.get(item.row.mediaFilename), alt: "" }) : "—"),
              h("td", {}, item.row.adName || item.row.rowId, h("div", { className: "muted" }, item.row.rowId)),
              h("td", {}, item.row.locale),
              h("td", {}, item.row.mediaFilename || "—"),
              h("td", {}, item.eligible ? h("span", { className: "badge s-pass" }, "prête") : h("span", { className: "badge s-fail" }, `${item.issues.length} anomalie(s)`), ...item.issues.map((issue) => h("div", { className: "muted" }, `${issue.field} : ${issue.message}`))),
            ),
          ),
        )
      : null,
    ...(preview?.ok ? preview.manifest.warnings.map((warning) => h("div", { className: "alert" }, warning)) : []),
  );
}

function analysisSection() {
  const preview = state.preview;
  const eligible = preview?.ok ? preview.manifest.rows.filter((row) => row.eligible).length : 0;
  const canRun = state.phase === "ready" && preview?.ok && eligible > 0 && !state.busy;
  return h(
    "section",
    { className: "card" },
    h("h2", {}, "3. Analyse"),
    h("p", {}, `Au plus ${eligible} appel(s) facturé(s) sur votre clé OpenAI. Une copie réduite de chaque image et les références de sa ligne sont envoyées à OpenAI (modèle configuré côté serveur). Ce clic autorise cette validation.`),
    state.phase !== "ready" ? h("p", { className: "muted" }, "Configurez d'abord votre clé (étape 1).") : null,
    h("div", { className: "actions" }, h("button", { type: "button", className: "primary", onclick: analyze, disabled: !canRun }, `Analyser les ${eligible} annonce(s)`)),
    state.importErrors.length ? h("div", { className: "error" }, ...state.importErrors.map((error) => h("div", {}, error))) : null,
    state.progress.length ? h("ul", { className: "files" }, ...state.progress.map((line) => h("li", {}, line))) : null,
  );
}

const ORIGIN_LABEL: Record<CheckResult["origin"], string> = {
  meta_requirement: "Exigence Meta",
  meta_recommendation: "Recommandation Meta",
  poc_limit: "Limite du POC",
};

const STATUS_LABEL: Record<string, string> = { pass: "conforme", fail: "écart", not_checked: "non vérifié", not_applicable: "non applicable" };

function statusBadge(check: CheckResult) {
  const css = check.status === "fail" && check.origin === "meta_recommendation" ? "s-warn" : `s-${check.status}`;
  const label = check.status === "fail" && check.origin === "meta_recommendation" ? "écart (recommandation)" : STATUS_LABEL[check.status];
  return h("span", { className: `badge ${css}` }, label ?? check.status);
}

function rowCard(row: ReportRow) {
  const facts = row.facts;
  const thumb = state.thumbs.get(row.mediaFilename);
  const ai = row.ai;
  return h(
    "div",
    { className: "card" },
    h(
      "div",
      { className: "row-head" },
      thumb ? h("img", { className: "thumb", src: thumb, alt: "" }) : null,
      h(
        "div",
        {},
        h("h3", {}, row.adName || row.rowId),
        h("div", { className: "muted" }, `${row.rowId} · ${row.locale} · ${row.placement} · ${row.mediaFilename || "sans image"}`),
        facts ? h("div", {}, `${facts.format.toUpperCase()} · ${facts.width} × ${facts.height} px · ${formatBytes(facts.fileBytes)} · ratio ${(facts.width / facts.height).toFixed(3)}`) : null,
      ),
    ),
    ...row.kitIssues.map((issue) => h("div", { className: "error" }, `Contrat de kit — ${issue.field} : ${issue.message}`)),
    row.mediaError ? h("div", { className: "error" }, `Image refusée (${row.mediaError}) : JPEG/PNG statique lisible dans les limites du POC attendu.`) : null,
    row.phase === "interrupted" || row.phase === "unknown_outcome"
      ? h("div", { className: "error" }, row.phase === "interrupted" ? "Traitement interrompu : aucune relance automatique. Lancez une nouvelle validation si nécessaire." : "Issue de l'appel IA inconnue (un coût a pu être facturé). Aucune relance automatique.")
      : null,
    row.phase === "awaiting_media" ? h("p", { className: "muted" }, "Pas encore analysée.") : null,
    row.technical.length
      ? h(
          "table",
          {},
          h("tr", {}, h("th", {}, "Contrôle"), h("th", {}, "Statut"), h("th", {}, "Observé"), h("th", {}, "Attendu"), h("th", {}, "Action / source")),
          ...row.technical
            .filter((check) => check.status !== "not_applicable")
            .map((check) =>
              h(
                "tr",
                {},
                h("td", {}, check.label, h("div", { className: "muted" }, ORIGIN_LABEL[check.origin])),
                h("td", {}, statusBadge(check)),
                h("td", {}, check.observed),
                h("td", {}, check.expected),
                h("td", {}, check.status === "pass" ? "" : check.action, check.sourceUrl ? h("div", { className: "muted" }, check.sourceUrl) : check.reason ? h("div", { className: "muted" }, check.reason) : null),
              ),
            ),
        )
      : null,
    ai
      ? h(
          "div",
          {},
          h("h3", {}, "Revue IA du texte visible (à confirmer)"),
          ai.status !== "completed" && ai.errorCode ? h("div", { className: "error" }, `${AI_ERROR_MESSAGES[ai.errorCode]} Les mesures techniques ci-dessus restent valables.`) : null,
          ai.status === "completed" && ai.findings.length === 0 ? h("p", {}, "Aucune contradiction explicite repérée avec les références fournies.") : null,
          ...ai.findings.map((finding) =>
            h(
              "div",
              { className: "alert" },
              h("strong", {}, `À confirmer — ${finding.kind.replace("_mismatch", "")} : `),
              `« ${finding.observedText} » ; référence (${finding.referenceField}) : « ${finding.expected} ». `,
              finding.explanation,
              h("div", {}, h("strong", {}, "Action : "), finding.action),
            ),
          ),
          ai.notChecked.length ? h("div", { className: "muted" }, "Non vérifié : ", ai.notChecked.map((item) => `${item.check} (${item.reason})`).join(" ; ")) : null,
          ai.observations.length ? h("details", {}, h("summary", {}, "Texte visible lu par l'IA"), ...ai.observations.map((item) => h("div", { className: "muted" }, `« ${item.text} » — ${item.legibility}, langue : ${item.language ?? "indéterminée"}`))) : null,
          ai.usage ? h("div", { className: "muted" }, `Usage : ${ai.usage.inputTokens} jetons en entrée, ${ai.usage.outputTokens} en sortie (dont ${ai.usage.reasoningTokens} de raisonnement) · ${((ai.latencyMs ?? 0) / 1000).toFixed(1)} s · ${ai.model ?? ""}`) : null,
        )
      : null,
  );
}

function reportSection() {
  const report = state.report;
  if (!report) return null;
  const s = report.summary;
  return h(
    "section",
    {},
    h(
      "div",
      { className: "card" },
      h("h2", {}, "4. Rapport"),
      h(
        "div",
        { className: "summary-line" },
        h("span", { className: "s-fail" }, `${s.technicalErrors} erreur(s) technique(s)`),
        h("span", { className: "s-fail" }, `${s.kitIssues} anomalie(s) de kit`),
        h("span", { className: "s-warn" }, `${s.aiAlerts} alerte(s) IA à confirmer`),
        h("span", { className: "s-warn" }, `${s.recommendationGaps} écart(s) à des recommandations`),
        h("span", { className: "s-info" }, `${s.notChecked} contrôle(s) non vérifié(s)`),
      ),
      h("p", { className: "muted" }, `Règles ${report.rulesetId} v${report.rulesetVersion} (sources Meta lues le 2026-10-06) · prompt ${report.promptVersion} · modèle ${report.model}. Pas de score global ni de validation par Meta.`),
      ...report.coverage.notes.map((note) => h("div", { className: "muted" }, `• ${note}`)),
      ...report.warnings.map((warning) => h("div", { className: "alert" }, warning)),
      h(
        "div",
        { className: "actions" },
        h("button", { type: "button", onclick: exportCsv, disabled: state.busy }, "Exporter le CSV"),
        h("button", { type: "button", onclick: explain, disabled: state.busy }, "Expliquer le rapport dans ChatGPT"),
        h("button", { type: "button", onclick: finish, disabled: state.busy }, "Terminer et supprimer"),
      ),
      state.exportNote ? h("p", { className: "muted" }, state.exportNote) : null,
      state.exportText ? h("textarea", { className: "export", readonly: true, rows: 8 }, state.exportText) : null,
      state.summaryText ? h("textarea", { className: "summary", readonly: true, rows: 8 }, state.summaryText) : null,
    ),
    ...report.rows.map(rowCard),
  );
}

function diagnosticsSection() {
  const info = hostInfo();
  return h(
    "details",
    { className: "card" },
    h("summary", {}, "Diagnostic de l'hôte"),
    h(
      "dl",
      { className: "facts" },
      h("dt", {}, "Origine du composant"),
      h("dd", {}, window.location.origin),
      h("dt", {}, "Hôte"),
      h("dd", {}, info.connected ? info.hostName : `non connecté${info.error ? ` (${info.error})` : ""}`),
      h("dt", {}, "Capacités"),
      h("dd", {}, `liens externes : ${info.openLinks ? "oui" : "non"} · téléchargement : ${info.downloadFile ? "oui" : "non"} · message : ${info.message ? "oui" : "non"}`),
    ),
    h("div", { className: "actions" }, h("button", { type: "button", onclick: testService }, "Tester l'accès au service")),
    state.diagnostics ? h("p", { className: "muted" }, state.diagnostics) : null,
  );
}

function render(): void {
  replace(
    root,
    h("header", {}, h("h1", {}, "Campaign Preflight"), h("p", { className: "muted" }, "Repérez les erreurs dans vos annonces Instagram Feed avant de transmettre votre kit à l'agence.")),
    steps(),
    state.notice ? h("p", { role: "status" }, state.notice) : null,
    state.error ? h("div", { className: "error", role: "alert" }, state.error) : null,
    configSection(),
    kitSection(),
    analysisSection(),
    reportSection(),
    diagnosticsSection(),
  );
}

window.addEventListener("pagehide", revokeThumbs);
void connectHost().then(render);
render();
