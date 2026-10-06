# Architecture

Monolithe modulaire TypeScript : un dépôt, un déploiement Vercel, Next.js 16 (App Router) sur Node.js 24.

```
ChatGPT ──MCP (Streamable HTTP)──▶ /mcp ── open_campaign_preflight / get_meta_requirements
   │                                        └─ ressource ui://campaign-preflight/widget-v1.html (MCP Apps)
   │
   └─ composant (iframe) ──fetch + Bearer──▶ /api/session(s), /api/runs/…   (CORS : origine exacte)
                                               │
navigateur de l'utilisateur ──▶ /setup ──POST JSON same-origin──▶ /api/setup
                                               │
                                     services (session, run) ──▶ Upstash Redis (CAS Lua, TTL absolu)
                                               │
                                     adaptateurs : sharp (mémoire), OpenAI Responses (clé de session)
```

## Couches

| Dossier | Rôle | Dépendances autorisées |
|---|---|---|
| `src/domain` | CSV imposé, règles, contrat IA, prompt, rapport et export : fonctions pures | zod, csv-parse |
| `src/services` | session (association, autorisation, suppression), run (claim, analyse, plafonds) | domain, interfaces `SessionStore` et `VisionAnalyzer` |
| `src/adapters` | Upstash Redis, OpenAI, sharp | SDK correspondants |
| `src/security` | capacités, AES-256-GCM, CORS, origine, IP fiable | node:crypto |
| `src/app` | routes fines : valider, autoriser, appeler le service, sérialiser | services, adapters (via `src/server/context.ts`) |
| `src/mcp` | outils publics et ressource UI | domain |
| `src/widget` | composant HTML/CSS/TS, bundle esbuild inline | domain (contrat CSV partagé), ext-apps |

Seules deux frontières sont injectées : `SessionStore` et `VisionAnalyzer`. Les faux de test vivent dans `tests/` et ne sont jamais atteignables en production.

## MCP et composant

- Deux outils publics en lecture seule (`readOnlyHint: true`, `openWorldHint: false`), avec `outputSchema`. Ni l'un ni l'autre ne crée de session ni n'engage de dépense.
- La ressource `text/html;profile=mcp-app` déclare `_meta.ui.csp.connectDomains = [APP_ORIGIN]` et `_meta.ui.domain = APP_ORIGIN`. Le HTML est autonome : JS et CSS inline, aucune ressource tierce.
- Le composant n'utilise que des API documentées : `App` de `@modelcontextprotocol/ext-apps` (`openLink`, `downloadFile`, `sendMessage`), avec repli sur `window.openai.openExternal`.
- Le MCP public n'accède à aucun rapport, image ou secret. Les traitements privés passent par HTTPS avec le bearer de session.

## Session éphémère (BYOK)

1. Le composant crée la session : `POST /api/sessions` renvoie le bearer (32 octets) et le code d'association (10 octets, base32 sur 16 caractères). Ils ne sont transmis qu'une seule fois. Redis n'en conserve que les empreintes SHA-256.
2. L'utilisateur ouvre `/setup`, une URL fixe sans paramètre, et saisit le code et sa clé. `POST /api/setup` exige un JSON same-origin d'au plus 8 Kio. La clé est chiffrée, puis le code est consumé et l'enveloppe écrite **dans le même script Lua**.
3. « Vérifier la connexion » interroge `GET /api/session` avec le bearer et renvoie `ready`.
4. Le document de session est un HASH Redis `{v, doc}`. Toute écriture est un compare-and-set qui réapplique `PEXPIREAT` sur l'échéance absolue (création + 60 min). Une session supprimée n'est jamais recréée.

## Analyse d'une validation

- `POST /api/runs` reçoit le CSV et l'inventaire des noms de fichiers. Le serveur parse, fige le manifest, la version des règles, celle du prompt et le modèle, puis réserve atomiquement un des 3 runs.
- `POST /api/runs/:runId/rows/:rowId/analyze` reçoit un multipart avec un seul fichier, lu dans la limite de 3 Mio. Le traitement suit cet ordre :
  1. empreinte SHA-256 ;
  2. **claim** atomique (une opération lourde par session, 75 s au plus, borné par la session) ;
  3. décodage et mesures (sharp, en mémoire) ;
  4. règles pures, puis **persistance des mesures** ;
  5. réservation de la tentative IA (session 9, run 3, global/jour) ;
  6. revérification de la session ;
  7. déchiffrement de la clé pour **cet** appel ;
  8. appel OpenAI (timeout 30 s, échéance applicative 45 s, `maxRetries: 0`) ;
  9. écriture finale conditionnelle au claim courant.
- Si l'issue est inconnue (timeout, réseau), la ligne passe en `unknown_outcome`. Si le claim expire, elle passe en `interrupted`, ce que le GET constate sans cron. Il n'y a jamais de relance automatique : une nouvelle tentative passe par un nouveau run.

## Rapport

JSON versionné (`campaign-preflight.report/v1`, 256 Kio maximum) qui contient :
- les lignes et les mesures ;
- les contrôles `pass`, `fail`, `not_checked` et `not_applicable` ;
- les alertes IA « à confirmer » ;
- les contrôles non effectués ;
- la couverture, les versions et l'usage.

L'export CSV compte une ligne par contrôle ou alerte et neutralise les formules. Le résumé partageable est nettoyé : sans URL privée, jeton ni identifiant de session.

## Limites connues

- Le bearer vit en mémoire du composant : un rechargement impose une nouvelle session et une nouvelle saisie.
- Rien ne garantit la poursuite d'un traitement si l'interface se ferme.
- Isolation par possession d'un secret : ce n'est ni une identité vérifiée, ni une architecture multi-utilisateur de production.
