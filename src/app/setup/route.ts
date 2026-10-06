import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Page externe /setup : HTML statique servi par Next.js, sans script de
 * framework, analytics ni ressource tierce. CSP stricte par empreintes.
 * Aucun paramètre secret dans l'URL ; champs effacés après envoi.
 */
const STYLE = `
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1d1d1f;background:#fff}
h1{font-size:20px;margin:0 0 8px}
p{margin:8px 0}
.muted{color:#5f6368;font-size:13.5px}
label{display:block;margin:14px 0 4px;font-weight:600}
input{width:100%;font:inherit;padding:8px 10px;border:1px solid #c4c7cc;border-radius:6px;box-sizing:border-box}
#code{font-family:ui-monospace,Menlo,monospace;letter-spacing:1px;text-transform:uppercase}
button{margin-top:16px;font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #1f5fbf;background:#1f5fbf;color:#fff;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
.warn{border-left:3px solid #9a6700;padding:6px 10px;background:#fff8e6;margin:12px 0}
#msg{margin-top:14px;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#1f1f21;color:#ececee}input{background:#2a2b2e;color:#ececee;border-color:#3a3c40}.warn{background:#2f2a1e}.muted{color:#a8abb2}}
`.trim();

const SCRIPT = `
(function(){
  var form=document.getElementById("f"),btn=document.getElementById("b"),msg=document.getElementById("msg");
  form.addEventListener("submit",function(e){
    e.preventDefault();
    var code=form.elements.code.value,apiKey=form.elements.apiKey.value;
    form.elements.code.value="";form.elements.apiKey.value="";
    btn.disabled=true;msg.textContent="Envoi en cours…";
    fetch("/api/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:code,apiKey:apiKey}),credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer"})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(b){
        msg.textContent=r.ok?"Clé enregistrée pour cette session. Retournez dans ChatGPT et cliquez sur « Vérifier la connexion ».":((b&&b.error&&b.error.message)||"Échec de l'enregistrement.");
      });})
      .catch(function(){msg.textContent="Réseau indisponible. Réessayez.";})
      .then(function(){code="";apiKey="";btn.disabled=false;});
  });
})();
`.trim();

const sha = (value: string) => `'sha256-${createHash("sha256").update(value, "utf8").digest("base64")}'`;

const CSP = [
  "default-src 'none'",
  `script-src ${sha(SCRIPT)}`,
  `style-src ${sha(STYLE)}`,
  "connect-src 'self'",
  "img-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

const HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Campaign Preflight — associer votre clé</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Campaign Preflight — associer votre clé OpenAI</h1>
<p>Saisissez le <strong>code affiché dans VOTRE composant</strong> Campaign Preflight dans ChatGPT, puis votre clé API OpenAI.</p>
<p>Cette session temporaire (60 minutes maximum) pourra utiliser la clé pour ses analyses. Chaque analyse est facturée sur votre compte API OpenAI, séparément de votre abonnement ChatGPT.</p>
<div class="warn">N'utilisez jamais un code reçu d'un tiers. Ne collez jamais ce code ni votre clé dans la conversation ChatGPT.</div>
<form id="f" method="post" autocomplete="off" novalidate>
<label for="code">Code d'association</label>
<input id="code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" required placeholder="XXXX-XXXX-XXXX-XXXX">
<label for="apiKey">Clé API OpenAI</label>
<input id="apiKey" name="apiKey" type="password" autocomplete="off" spellcheck="false" maxlength="512" required placeholder="sk-…">
<button id="b" type="submit">Associer la clé à cette session</button>
</form>
<p id="msg" role="status" aria-live="polite"></p>
<p class="muted">La clé est chiffrée côté serveur (AES-256-GCM) et retirée à la fin de la session ou à son expiration. Elle n'est pas testée auprès d'OpenAI à cette étape : la première analyse vérifiera l'accès au modèle. Le serveur la déchiffre en mémoire uniquement le temps d'un appel à OpenAI.</p>
<script>${SCRIPT}</script>
</body>
</html>`;

export async function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": CSP,
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), clipboard-read=()",
    },
  });
}
