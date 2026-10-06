// Construit le composant ChatGPT (HTML/CSS/TS) en un module TypeScript
// exportant le JS et le CSS sous forme de chaînes, servis par la ressource MCP.
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const result = await build({
  entryPoints: ["src/widget/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  write: false,
  define: {
    "process.env.NODE_ENV": '"production"',
    __WIDGET_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"),
  },
  // Même contrat CSV qu'au serveur, avec la version navigateur du parseur.
  alias: { "csv-parse/sync": "csv-parse/browser/esm/sync" },
  logLevel: "warning",
});

const js = result.outputFiles[0].text;
const css = await readFile("src/widget/styles.css", "utf8");
const out =
  "// Fichier généré par scripts/build-widget.mjs — ne pas modifier.\n" +
  `export const WIDGET_JS = ${JSON.stringify(js)};\n` +
  `export const WIDGET_CSS = ${JSON.stringify(css)};\n`;
await writeFile("src/mcp/widget-bundle.generated.ts", out);
console.log(`widget: ${(js.length / 1024).toFixed(1)} Kio JS, ${(css.length / 1024).toFixed(1)} Kio CSS`);
