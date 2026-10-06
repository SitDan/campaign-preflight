import { LIMITS } from "@/config/limits";
import { CSV_TEMPLATE, parseKit, type ImportResult } from "@/domain/kit";
import { AI_ERROR_MESSAGES, toSummaryText, type Report, type ReportRow } from "@/domain/report";
import type { CheckResult } from "@/domain/rules";
import { createApi, forgetSession, hasSession } from "./api";
import { formatBytes, h, replace } from "./dom";
import { connectHost, downloadText, hostInfo, hostTheme, openExternal, sendChatMessage } from "./host";

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

type KeyPhase = "intro" | "pending" | "ready";

const state = {
  keyPhase: "intro" as KeyPhase,
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
  kitEditing: true,
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
  state.notice = "";
  state.error = message;
  render();
}

function resetKit() {
  state.csvName = "";
  state.csvText = "";
  state.images = new Map();
  state.thumbs = new Map();
  state.preview = null;
  state.importErrors = [];
  state.report = null;
  state.progress = [];
  state.exportText = "";
  state.exportNote = "";
  state.summaryText = "";
  state.kitEditing = true;
}

function updatePreview() {
  state.importErrors = [];
  state.preview = state.csvText ? parseKit(state.csvText, [...state.images.values()].map((file) => ({ name: file.name, size: file.size }))) : null;
}

/** Miniatures en data: (les URL blob: sont refusées par la CSP de certains hôtes). */
function readThumb(file: File): Promise<string> {
  return new Promise((resolve) => {
    if (file.size > LIMITS.imageMaxBytes) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function setImages(files: File[]) {
  state.images = new Map(files.map((file) => [file.name, file]));
  const thumbs = await Promise.all(files.map(async (file) => [file.name, await readThumb(file)] as const));
  state.thumbs = new Map(thumbs.filter(([, url]) => url));
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
  state.keyPhase = "pending";
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
    state.keyPhase = "intro";
    state.code = null;
    return fail(`${result.message} (un rechargement du composant impose aussi une nouvelle session).`);
  }
  state.expiresAt = result.data.expiresAt;
  if (result.data.state === "ready") {
    state.keyPhase = "ready";
    state.code = null;
    setBusy(false, "Clé associée à cette session. Elle sera vérifiée auprès d'OpenAI lors de la première analyse.");
    return;
  }
  state.busy = false;
  state.notice = "";
  state.error = result.data.codeActive
    ? "Aucune clé associée pour l'instant : terminez la saisie sur la page de configuration, puis vérifiez à nouveau."
    : "Le code a expiré (10 minutes). Annulez puis recommencez.";
  render();
}

async function finish() {
  setBusy(true, "Suppression…");
  const result = hasSession() ? await api.deleteSession() : null;
  forgetSession();
  resetKit();
  state.keyPhase = "intro";
  state.code = null;
  state.busy = false;
  state.notice =
    result && !result.ok
      ? `Session déjà inactive côté serveur (${result.message})`
      : "Session supprimée : clé chiffrée et résultats retirés de notre stockage. Votre clé reste valide chez OpenAI : révoquez-la depuis votre compte si besoin.";
  render();
}

async function loadDemo() {
  setBusy(true, "Chargement du kit d'exemple…");
  const files = await Promise.all([
    api.demoFile("kit.csv", "text/csv"),
    api.demoFile("aurore-fr.jpg", "image/jpeg"),
    api.demoFile("aurore-uk.jpg", "image/jpeg"),
    api.demoFile("aurore-de.png", "image/png"),
  ]);
  if (files.some((file) => !file)) return fail("Kit d'exemple indisponible depuis le composant.");
  const [csv, ...images] = files as File[];
  resetKit();
  state.csvName = csv!.name;
  state.csvText = await csv!.text();
  await setImages(images);
  setBusy(false, "Kit d'exemple chargé : 3 annonces fictives de la collection « Aurore ».");
}

async function onCsv(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > LIMITS.csvMaxBytes) return fail("CSV de plus de 64 Kio : non pris en charge par ce POC.");
  state.report = null;
  state.csvName = file.name;
  state.csvText = await file.text();
  updatePreview();
  state.error = "";
  render();
}

async function onImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  state.report = null;
  await setImages(files);
  state.error = "";
  render();
}

async function analyze() {
  const preview = state.preview;
  if (!preview?.ok) return;
  state.progress = [];
  state.exportText = "";
  state.exportNote = "";
  state.summaryText = "";
  state.kitEditing = false;
  setBusy(true, "Envoi du CSV…");
  const created = await api.createRun(state.csvText, [...state.images.values()].map((file) => ({ name: file.name, size: file.size })));
  if (!created.ok) {
    state.kitEditing = true;
    state.importErrors = Array.isArray(created.details?.errors) ? (created.details.errors as string[]) : [];
    return fail(created.message);
  }
  state.report = created.data;
  const pending = created.data.rows.filter((row) => row.phase === "awaiting_media");
  for (const [index, row] of pending.entries()) {
    const file = state.images.get(row.mediaFilename);
    if (!file) continue;
    state.notice = `Analyse ${index + 1}/${pending.length} : « ${row.adName} »…`;
    render();
    let result = await api.analyzeRow(created.data.runId, row.rowId, file);
    if (!result.ok && result.code === "operation_in_progress") {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      result = await api.getRun(created.data.runId);
    }
    if (!result.ok) {
      state.progress.push(`« ${row.adName} » : ${result.message}`);
      if (result.status === 401) {
        forgetSession();
        state.keyPhase = "intro";
        return fail(`${result.message} Les résultats déjà obtenus restent affichés.`);
      }
      continue;
    }
    state.report = result.data;
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
    ? "Téléchargement demandé à ChatGPT."
    : `Téléchargement non proposé par cet hôte : voici le CSV complet (${(new TextEncoder().encode(result.data).byteLength / 1024).toFixed(1).replace(".", ",")} Kio, limite 256 Kio). Sélectionnez-le, copiez-le et enregistrez-le dans un fichier .csv (UTF-8).`;
  setBusy(false);
}

async function explain() {
  if (!state.report) return;
  const summary = toSummaryText(state.report);
  const sent = await sendChatMessage(summary);
  state.summaryText = sent ? "" : summary;
  state.notice = sent ? "Résumé envoyé dans la conversation (sans clé, jeton ni lien privé)." : "Envoi indisponible : copiez le résumé ci-dessous dans la conversation.";
  render();
}

async function downloadTemplate() {
  const ok = await downloadText("campaign-preflight-modele.csv", "text/csv", CSV_TEMPLATE);
  state.exportText = ok ? "" : CSV_TEMPLATE;
  state.exportNote = ok ? "Modèle demandé à ChatGPT." : "Modèle CSV à copier dans un fichier .csv :";
  render();
}

function newValidation() {
  state.report = null;
  state.kitEditing = true;
  state.progress = [];
  state.exportText = "";
  state.exportNote = "";
  state.summaryText = "";
  state.notice = "";
  render();
}

async function testService() {
  const rules = await api.getRules();
  state.diagnostics = rules.ok ? `Service joignable — référentiel ${rules.data.rulesetVersion}, ${rules.data.metaRules.length} règles Meta.` : `Échec : ${rules.message}`;
  render();
}

// ---------- composants d'interface ----------

function button(label: string, onclick: () => void, variant: "primary" | "secondary" | "link" = "secondary", disabled = false) {
  return h("button", { type: "button", className: variant, onclick, disabled: disabled || state.busy }, label);
}

function picker(label: string, accept: string, multiple: boolean, onchange: (event: Event) => void) {
  return h("label", { className: `picker${state.busy ? " disabled" : ""}` }, h("input", { type: "file", accept, multiple, onchange, disabled: state.busy }), label);
}

function selectableText(text: string, className: string) {
  if (!text) return [];
  const area = h("textarea", { className, readonly: true, rows: 7 }, text);
  return [area, h("div", { className: "actions" }, button("Tout sélectionner", () => area.select(), "link"))];
}

type StepStatus = "todo" | "current" | "done";

function step(index: number, title: string, status: StepStatus, summary: Node | string | null, body: Array<Node | null> | null) {
  return h(
    "section",
    { className: `step ${status}` },
    h(
      "div",
      { className: "step-head" },
      h("span", { className: "step-num" }, status === "done" ? "✓" : String(index)),
      h("div", { className: "step-title" }, h("h2", {}, title), summary ? h("div", { className: "step-summary" }, summary) : null),
    ),
    status === "current" && body ? h("div", { className: "step-body" }, ...body) : null,
  );
}

function keyStep(): HTMLElement {
  if (state.keyPhase === "ready") {
    return step(1, "Votre clé OpenAI", "done", h("span", {}, `Associée à cette session jusqu'à ${time(state.expiresAt)} · `, button("Terminer et supprimer", finish, "link")), null);
  }
  if (state.keyPhase === "pending") {
    return step(1, "Votre clé OpenAI", "current", null, [
      h(
        "ol",
        { className: "howto" },
        h("li", {}, "Ouvrez la page de configuration sécurisée."),
        h("li", {}, "Saisissez-y ce code puis votre clé API OpenAI."),
        h("li", {}, "Revenez ici et cliquez sur « J'ai terminé »."),
      ),
      h("div", { className: "code", "aria-label": "Code d'association" }, state.code ?? ""),
      h("p", { className: "muted small" }, `Code à usage unique, valable jusqu'à ${time(state.codeExpiresAt)}. Ne collez jamais ce code ni votre clé dans la conversation.`),
      h("div", { className: "actions" }, button("Ouvrir la page de configuration", openSetup, "secondary"), button("J'ai terminé, vérifier", verify, "primary"), button("Annuler", finish, "link")),
      state.setupFallback ? h("p", { className: "small" }, "Ouverture automatique impossible : ouvrez ", h("span", { className: "mono" }, SETUP_URL), " dans votre navigateur.") : null,
    ]);
  }
  return step(1, "Votre clé OpenAI", "current", null, [
    h("p", {}, "Les analyses utilisent votre propre clé API OpenAI. Elles sont facturées sur votre compte API, séparément de votre abonnement ChatGPT : 1 appel par annonce, 3 au maximum par validation."),
    h("p", { className: "muted small" }, "La clé se saisit sur une page externe sécurisée, jamais dans la conversation. Elle est chiffrée et supprimée au bout de 60 minutes au plus."),
    h("div", { className: "actions" }, button("Configurer ma clé", configure, "primary")),
  ]);
}

function thumbnail(src: string | undefined) {
  if (!src) return h("div", { className: "thumb empty" }, "aperçu indisponible");
  const img = h("img", { className: "thumb", src, alt: "" });
  img.addEventListener("error", () => img.replaceWith(h("div", { className: "thumb empty" }, "aperçu bloqué par l'hôte")));
  return img;
}

function adPreviewCard(item: Extract<ImportResult, { ok: true }>["manifest"]["rows"][number]) {
  return h(
    "div",
    { className: "ad" },
    thumbnail(state.thumbs.get(item.row.mediaFilename)),
    h(
      "div",
      { className: "ad-body" },
      h("div", { className: "ad-title" }, item.row.adName || item.row.rowId, h("span", { className: "chip" }, item.row.locale || "—")),
      h("div", { className: "muted small" }, `${item.row.mediaFilename || "aucune image"} · ${item.row.rowId}`),
      item.eligible
        ? h("div", { className: "pill ok" }, "Prête à analyser")
        : h("div", {}, h("div", { className: "pill bad" }, `${item.issues.length} point(s) à corriger dans le CSV`), ...item.issues.map((issue) => h("div", { className: "small" }, `• ${issue.field} : ${issue.message}`))),
    ),
  );
}

function kitStep(): HTMLElement {
  const ready = state.keyPhase === "ready";
  const preview = state.preview;
  const rows = preview?.ok ? preview.manifest.rows : [];
  const eligible = rows.filter((row) => row.eligible).length;
  if (!state.kitEditing && state.report) {
    return step(2, "Votre kit", "done", h("span", {}, `${state.csvName} · ${state.images.size} image(s) · `, button("Nouvelle validation", newValidation, "link")), null);
  }
  return step(2, "Votre kit", ready ? "current" : "todo", ready ? null : "Disponible après la configuration de la clé.", [
    h("p", { className: "muted small" }, "Un fichier CSV au format du modèle (une ligne par annonce, 3 maximum) et les images JPEG/PNG qu'il référence."),
    h(
      "div",
      { className: "actions" },
      picker(state.csvName ? `CSV : ${state.csvName}` : "Choisir le CSV", ".csv,text/csv", false, onCsv),
      picker(state.images.size ? `${state.images.size} image(s) choisie(s)` : "Choisir les images", ".jpg,.jpeg,.png,image/jpeg,image/png", true, onImages),
    ),
    h("div", { className: "actions" }, button("Utiliser le kit d'exemple", loadDemo, "link"), button("Modèle CSV", downloadTemplate, "link")),
    preview && !preview.ok ? h("div", { className: "box bad" }, h("strong", {}, "Import à corriger"), ...preview.errors.map((error) => h("div", { className: "small" }, `• ${error}`))) : null,
    rows.length ? h("div", { className: "ads" }, ...rows.map(adPreviewCard)) : null,
    ...(preview?.ok ? preview.manifest.warnings.map((warning) => h("div", { className: "box warn small" }, warning)) : []),
    state.importErrors.length ? h("div", { className: "box bad" }, ...state.importErrors.map((error) => h("div", { className: "small" }, `• ${error}`))) : null,
    rows.length
      ? h(
          "div",
          { className: "analyze" },
          h("p", { className: "small" }, `Au plus ${eligible} appel(s) facturé(s) sur votre clé. Une copie réduite de chaque image et les références de sa ligne sont envoyées à OpenAI. Ce clic autorise cette validation.`),
          button(`Analyser ${eligible} annonce(s)`, analyze, "primary", eligible === 0),
        )
      : null,
    state.exportNote && !state.report ? h("p", { className: "small" }, state.exportNote) : null,
    ...(state.report ? [] : selectableText(state.exportText, "export")),
  ]);
}

const ORIGIN_LABEL: Record<CheckResult["origin"], string> = {
  meta_requirement: "Exigence Meta",
  meta_recommendation: "Recommandation Meta",
  poc_limit: "Limite du POC",
};

function adVerdict(row: ReportRow): { label: string; css: string } {
  const blocking = row.kitIssues.length > 0 || row.mediaError !== null || row.technical.some((check) => check.status === "fail" && check.origin !== "meta_recommendation");
  if (blocking) return { label: "À corriger", css: "bad" };
  if (row.phase === "awaiting_media") return { label: "Non analysée", css: "neutral" };
  if (row.phase === "interrupted" || row.phase === "unknown_outcome" || (row.ai && row.ai.status !== "completed")) return { label: "Revue incomplète", css: "warn" };
  if ((row.ai?.findings.length ?? 0) > 0 || row.technical.some((check) => check.status === "fail")) return { label: "À vérifier", css: "warn" };
  return { label: "Aucun écart repéré", css: "ok" };
}

function checkLine(check: CheckResult) {
  return h(
    "div",
    { className: "check" },
    h("div", {}, h("strong", {}, check.label), h("span", { className: "muted small" }, ` · ${ORIGIN_LABEL[check.origin]}`)),
    h("div", { className: "small" }, `Observé : ${check.observed} — attendu : ${check.expected}`),
    check.status !== "pass" ? h("div", { className: "small" }, check.status === "not_checked" ? `Non vérifié : ${check.reason ?? ""}` : `À demander : ${check.action}`) : null,
    check.sourceUrl ? h("div", { className: "muted small mono" }, check.sourceUrl) : null,
  );
}

function reportCard(row: ReportRow) {
  const verdict = adVerdict(row);
  const facts = row.facts;
  const ai = row.ai;
  const failures = row.technical.filter((check) => check.status === "fail");
  const notChecked = row.technical.filter((check) => check.status === "not_checked");
  const passed = row.technical.filter((check) => check.status === "pass");
  return h(
    "div",
    { className: "result" },
    h(
      "div",
      { className: "ad" },
      thumbnail(state.thumbs.get(row.mediaFilename)),
      h(
        "div",
        { className: "ad-body" },
        h("div", { className: "ad-title" }, row.adName || row.rowId, h("span", { className: "chip" }, row.locale)),
        h("div", { className: "muted small" }, facts ? `${facts.format.toUpperCase()} · ${facts.width} × ${facts.height} px · ${formatBytes(facts.fileBytes)} · ratio ${(facts.width / facts.height).toFixed(3).replace(".", ",")}` : row.mediaFilename),
        h("div", { className: `pill ${verdict.css}` }, verdict.label),
      ),
    ),
    row.kitIssues.length || row.mediaError || failures.length
      ? h(
          "div",
          { className: "group bad" },
          h("h3", {}, "À corriger"),
          ...row.kitIssues.map((issue) => h("div", { className: "check" }, h("strong", {}, `CSV — ${issue.field}`), h("div", { className: "small" }, issue.message))),
          row.mediaError ? h("div", { className: "check" }, h("strong", {}, "Image refusée"), h("div", { className: "small" }, `${row.mediaError} : fournir un JPEG/PNG statique lisible dans les limites du POC.`)) : null,
          ...failures.map(checkLine),
        )
      : null,
    ai && ai.findings.length
      ? h(
          "div",
          { className: "group warn" },
          h("h3", {}, "À confirmer (alertes IA)"),
          ...ai.findings.map((finding) =>
            h(
              "div",
              { className: "check" },
              h("div", {}, h("strong", {}, `« ${finding.observedText} »`), h("span", { className: "muted small" }, ` · référence : ${finding.expected}`)),
              h("div", { className: "small" }, finding.explanation),
              h("div", { className: "small" }, `À demander : ${finding.action}`),
            ),
          ),
        )
      : null,
    ai && ai.status !== "completed" && ai.errorCode ? h("div", { className: "group warn" }, h("h3", {}, "Revue IA non achevée"), h("div", { className: "small" }, `${AI_ERROR_MESSAGES[ai.errorCode]} Les mesures techniques restent valables.`)) : null,
    row.phase === "interrupted" || row.phase === "unknown_outcome"
      ? h("div", { className: "group warn small" }, row.phase === "interrupted" ? "Traitement interrompu, sans relance automatique." : "Issue de l'appel IA inconnue (un coût a pu être facturé), sans relance automatique.")
      : null,
    notChecked.length || ai?.notChecked.length
      ? h(
          "details",
          { className: "group" },
          h("summary", {}, `Non vérifié (${notChecked.length + (ai?.notChecked.length ?? 0)})`),
          ...notChecked.map(checkLine),
          ...(ai?.notChecked ?? []).map((item) => h("div", { className: "check small" }, `IA — ${item.check} : ${item.reason}`)),
        )
      : null,
    ai?.status === "completed" && ai.findings.length === 0 ? h("p", { className: "small" }, "IA : aucune contradiction explicite repérée avec les références fournies.") : null,
    h(
      "details",
      { className: "group" },
      h("summary", {}, `Mesures conformes (${passed.length}) et détails`),
      ...passed.map(checkLine),
      ai?.observations.length ? h("div", { className: "small muted" }, "Texte visible lu par l'IA : ", ai.observations.map((item) => `« ${item.text} »`).join(" · ")) : null,
      ai?.usage ? h("div", { className: "small muted" }, `Usage IA : ${ai.usage.inputTokens} jetons en entrée, ${ai.usage.outputTokens} en sortie (dont ${ai.usage.reasoningTokens} de raisonnement), ${((ai.latencyMs ?? 0) / 1000).toFixed(1).replace(".", ",")} s.`) : null,
    ),
  );
}

function tile(value: number, label: string, css: string) {
  return h("div", { className: `tile ${css}` }, h("div", { className: "tile-value" }, String(value)), h("div", { className: "tile-label" }, label));
}

function reportStep(): HTMLElement {
  const report = state.report;
  if (!report) return step(3, "Rapport", "todo", "Disponible après l'analyse.", null);
  const s = report.summary;
  const analysing = state.busy && state.notice.startsWith("Analyse");
  return step(3, "Rapport", "current", null, [
    h(
      "div",
      { className: "tiles" },
      tile(s.technicalErrors + s.kitIssues, "à corriger", s.technicalErrors + s.kitIssues ? "bad" : "neutral"),
      tile(s.aiAlerts, "alerte(s) IA à confirmer", s.aiAlerts ? "warn" : "neutral"),
      tile(s.recommendationGaps, "écart(s) aux recommandations", s.recommendationGaps ? "warn" : "neutral"),
      tile(s.aiNotCompleted, "revue(s) IA incomplète(s)", s.aiNotCompleted ? "warn" : "neutral"),
    ),
    analysing ? h("div", { className: "box info small" }, state.notice) : null,
    ...report.rows.map(reportCard),
    ...state.progress.map((line) => h("div", { className: "box warn small" }, line)),
    h(
      "div",
      { className: "actions" },
      button("Exporter le CSV", exportCsv, "secondary"),
      button("Expliquer dans ChatGPT", explain, "secondary"),
      button("Nouvelle validation", newValidation, "link"),
      button("Terminer et supprimer", finish, "link"),
    ),
    state.exportNote ? h("p", { className: "small" }, state.exportNote) : null,
    ...selectableText(state.exportText, "export"),
    ...selectableText(state.summaryText, "summary"),
    h(
      "details",
      { className: "muted small" },
      h("summary", {}, "Sources et couverture"),
      h("div", {}, `Règles ${report.rulesetId} v${report.rulesetVersion} · prompt ${report.promptVersion} · modèle ${report.model}. Pas de score global ni de validation par Meta.`),
      ...report.coverage.notes.map((note) => h("div", {}, `• ${note}`)),
      ...report.warnings.map((warning) => h("div", {}, `• ${warning}`)),
    ),
  ]);
}

function diagnostics() {
  const info = hostInfo();
  return h(
    "details",
    { className: "diag muted small" },
    h("summary", {}, "Diagnostic de l'hôte"),
    h("div", {}, `Origine du composant : ${window.location.origin}`),
    h("div", {}, `Hôte : ${info.connected ? info.hostName : `non connecté${info.error ? ` (${info.error})` : ""}`}`),
    h("div", {}, `Capacités : liens externes ${info.openLinks ? "oui" : "non"} · téléchargement ${info.downloadFile ? "oui" : "non"} · message ${info.message ? "oui" : "non"}`),
    h("div", { className: "actions" }, button("Tester l'accès au service", testService, "link")),
    state.diagnostics ? h("div", {}, state.diagnostics) : null,
  );
}

function render(): void {
  const theme = hostTheme();
  if (theme) document.documentElement.dataset.theme = theme;
  const analysing = state.busy && state.notice.startsWith("Analyse");
  replace(
    root,
    h("header", {}, h("h1", {}, "Campaign Preflight"), h("p", { className: "muted" }, "Vérifiez vos annonces Instagram Feed avant de transmettre le kit à votre agence.")),
    state.error ? h("div", { className: "box bad", role: "alert" }, state.error) : null,
    state.notice && !analysing ? h("div", { className: "box info", role: "status" }, state.notice) : null,
    keyStep(),
    kitStep(),
    reportStep(),
    diagnostics(),
  );
}

void connectHost().then(render);
render();
