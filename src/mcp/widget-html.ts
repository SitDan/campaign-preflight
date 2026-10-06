import { WIDGET_CSS, WIDGET_JS } from "./widget-bundle.generated";

/**
 * Document HTML autonome du composant. La seule donnée injectée est l'origine
 * publique de l'API (non secrète). Aucun jeton, clé ou donnée de session.
 */
export function renderWidgetHtml(config: { apiBase: string }): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  const js = WIDGET_JS.replace(/<\/script/gi, "<\\/script");
  const css = WIDGET_CSS.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Campaign Preflight</title>
<style>${css}</style>
</head>
<body>
<div id="app" aria-live="polite"></div>
<script type="application/json" id="cp-config">${json}</script>
<script>${js}</script>
</body>
</html>`;
}
