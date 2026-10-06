// Scan simple des fichiers versionnés : clés OpenAI, bearers de session,
// clés privées, fichiers interdits. N'affiche jamais la valeur trouvée.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenPaths = [/^\.local-spec\//, /\.pdf$/i, /(^|\/)\.env(?!\.example$)/, /(^|\/)\.vercel\//];
const patterns = [
  ["clé OpenAI", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g],
  ["bearer de session", /\bcps_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g],
  ["clé privée", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["variable sensible renseignée", /\b(?:KV_REST_API_TOKEN|KV_REST_API_URL|REDIS_REST_TOKEN|UPSTASH_REDIS_REST_TOKEN|BYOK_ENCRYPTION_KEY_B64|OPENAI_API_KEY|VERCEL_OIDC_TOKEN)=[A-Za-z0-9_\-:/.+]{8,}/g],
];
// Valeurs synthétiques documentées, autorisées dans les tests.
const allowed = [/sk-canary-0000SYNTHETIC0000/, /sk-test-synthetic-0+/, /sk-attacker-key-0+/, /sk-concurrent-key-0+/, /sk-other-session-key-0+/];

let problems = 0;
for (const file of files) {
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    console.error(`Fichier interdit versionné : ${file}`);
    problems++;
    continue;
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [label, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (allowed.some((ok) => ok.test(match[0]))) continue;
      console.error(`${label} possible dans ${file} (valeur masquée)`);
      problems++;
    }
  }
}
if (problems > 0) process.exit(1);
console.log(`scan-secrets : ${files.length} fichiers versionnés, aucun secret détecté.`);
