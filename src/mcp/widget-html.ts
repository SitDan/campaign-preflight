/**
 * « Coquillage » du composant, mis en cache par l'hôte : volontairement minimal
 * et STABLE. Il charge le code réel depuis notre domaine à chaque ouverture
 * (/widget/app.js, /widget/app.css), si bien qu'un déploiement est servi à tous
 * les utilisateurs sans rafraîchir le plugin. Contrat stable avec le bundle :
 * #app et le JSON #cp-config. Seule donnée injectée : l'origine publique de l'API.
 */
export function renderWidgetHtml(config: { apiBase: string }): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  const base = config.apiBase.replace(/"/g, "");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Campaign Preflight</title>
<link rel="stylesheet" href="${base}/widget/app.css">
</head>
<body>
<div id="app" aria-live="polite"><p style="font:14px system-ui,sans-serif;opacity:.7">Chargement de Campaign Preflight…</p></div>
<script type="application/json" id="cp-config">${json}</script>
<script>setTimeout(function(){var a=document.getElementById("app");if(a&&!window.__cpLoaded){a.textContent="Chargement du composant impossible (réseau ou politique de l'hôte). Réessayez plus tard.";}},12000);</script>
<script src="${base}/widget/app.js"></script>
</body>
</html>`;
}
