import { formatBytes, h, replace } from "./dom";
import { connectHost, downloadText, hostInfo, openExternal } from "./host";

type WidgetConfig = { apiBase: string };

function readConfig(): WidgetConfig {
  const node = document.getElementById("cp-config");
  const parsed = JSON.parse(node?.textContent ?? "{}") as Partial<WidgetConfig>;
  return { apiBase: typeof parsed.apiBase === "string" ? parsed.apiBase : "" };
}

const config = readConfig();
const root = document.getElementById("app") as HTMLElement;

function diagnostics(): HTMLElement {
  const status = h("p", { className: "muted" });
  const fileList = h("ul", { className: "files" });
  const exportFallback = h("div");
  const info = hostInfo();

  const testService = async () => {
    replace(status, "Test en cours…");
    try {
      const response = await fetch(`${config.apiBase}/api/rules`, { method: "GET", credentials: "omit", cache: "no-store" });
      const body = (await response.json()) as { rulesetVersion?: string; metaRules?: unknown[] };
      replace(status, `Service joignable (HTTP ${response.status}) — référentiel ${body.rulesetVersion ?? "?"}, ${body.metaRules?.length ?? 0} règles Meta.`);
    } catch (error) {
      replace(status, `Échec de l'appel au service : ${error instanceof Error ? error.message : "erreur inconnue"}`);
    }
  };

  const testLink = async () => {
    const via = await openExternal(`${config.apiBase}/setup`);
    replace(status, via ? `Page externe demandée à l'hôte (${via === "standard" ? "ui/open-link" : "openExternal"}).` : `Ouverture refusée ou indisponible. Adresse à ouvrir manuellement : ${config.apiBase}/setup`);
  };

  const testExport = async () => {
    const csv = "row_id,status\r\ntest,ok\r\n";
    const ok = await downloadText("campaign-preflight-test.csv", "text/csv", csv);
    if (ok) {
      replace(status, "Téléchargement demandé à l'hôte.");
      replace(exportFallback);
    } else {
      replace(status, "Téléchargement indisponible : CSV affiché ci-dessous pour copie manuelle.");
      replace(exportFallback, h("textarea", { className: "export", readonly: true, rows: 3 }, csv));
    }
  };

  const onFiles = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const items = Array.from(input.files ?? []).map((file) => h("li", {}, `${file.name} — ${file.type || "type inconnu"} — ${formatBytes(file.size)}`));
    replace(fileList, ...items);
  };

  return h(
    "section",
    { className: "card" },
    h("h2", {}, "Diagnostic de l'hôte"),
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
    h(
      "div",
      { className: "actions" },
      h("button", { type: "button", onclick: testService }, "Tester l'accès au service"),
      h("button", { type: "button", onclick: testLink }, "Ouvrir la page externe"),
      h("button", { type: "button", onclick: testExport }, "Tester l'export"),
    ),
    h("label", { className: "file" }, "Sélection de fichiers (test) ", h("input", { type: "file", multiple: true, accept: ".csv,.jpg,.jpeg,.png", onchange: onFiles })),
    fileList,
    status,
    exportFallback,
  );
}

function render(): void {
  replace(
    root,
    h(
      "header",
      {},
      h("h1", {}, "Campaign Preflight"),
      h("p", { className: "muted" }, "Repérez les erreurs dans vos annonces Instagram Feed avant de transmettre votre kit à l'agence."),
    ),
    h(
      "section",
      { className: "card" },
      h("h2", {}, "Périmètre"),
      h("p", {}, "Images JPEG/PNG statiques, placement Instagram Feed, 3 annonces maximum (fr-FR, en-GB, de-DE)."),
      h("p", { className: "muted" }, "Les analyses IA utilisent votre clé API OpenAI, facturée séparément de votre abonnement ChatGPT. La clé se configure sur une page externe, jamais dans la conversation."),
    ),
    diagnostics(),
  );
}

void connectHost().then(render);
render();
