# Développement

## Commandes (Node 24, pnpm)

```bash
pnpm install --frozen-lockfile
pnpm check            # types + lint + tests (Vitest) + build
pnpm scan:secrets     # aucun secret dans les fichiers versionnés
pnpm audit --prod     # revue des dépendances de production
pnpm fixtures         # régénère le kit fictif et les visuels d'évaluation
pnpm eval             # mini-évaluation API réelle, locale (6 cas)
```

`pnpm eval` lit la clé dans `.env.eval.local` (`OPENAI_API_KEY=…`, `chmod 600`, jamais versionné, jamais affiché). `EVAL_MODEL=gpt-6.1-sol pnpm eval` compare un autre modèle sur les mêmes cas.

## Configuration

Les variables sont listées dans `.env.example`, avec des noms et des valeurs fictives :
- `APP_ORIGIN`, `WIDGET_ALLOWED_ORIGIN` (origine exacte du composant dans ChatGPT) ;
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash) ;
- `BYOK_ENCRYPTION_KEY_B64` / `BYOK_ENCRYPTION_KEY_ID` ;
- `OPENAI_MODEL`, `DEMO_ENABLED` et, en option, les plafonds anti-abus.

Le déploiement ne contient aucune clé OpenAI partagée. Les plafonds produit sont dans `src/config/limits.ts`.

L'exécution de la CI (`.github/workflows/ci.yml`) est désactivée sur ce dépôt privé, et les mêmes contrôles se lancent en local.

## Contrat CSV

Le fichier est en UTF-8 (BOM accepté), séparé par des virgules, avec des en-têtes exacts.

| Colonne | Contrat |
|---|---|
| `row_id`, `ad_name` | obligatoires (`row_id` unique) |
| `locale` | `fr-FR`, `en-GB` ou `de-DE` |
| `placement` | `instagram_feed` |
| `media_filename` | nom exact du visuel, sans chemin |
| `primary_text`, `cta` | obligatoires (contrat de kit du POC) |
| `landing_url` | HTTPS, sans identifiants (syntaxe seule) |
| `reference_collection`, `reference_offer` | facultatives, comparées au texte du visuel |
| `reference_date` + `reference_date_label` | facultatives : date `AAAA-MM-JJ` et son rôle |

## Kit fictif (`fixtures/demo/`)

| Fichier | Rôle |
|---|---|
| `kit.csv` et 3 visuels | marque « Maison Ardoise », collection « Aurore » : FR correcte, UK avec une offre contradictoire (30 % contre 20 %), DE avec une erreur de langue |
| `kit-invalide.csv` | import refusé (`cta` manquant, `row_id` en double) |
| `kit-excel-fr.csv` | séparateur « ; » : refusé, avec diagnostic et aide à la correction |
| `modele.csv` | modèle vide |

Les six cas d'évaluation annotés sont dans `evals/cases.json` et leurs visuels dans `evals/cases/`.

## Mises à jour du composant

ChatGPT met en cache le HTML du composant. Celui-ci est donc un coquillage stable, qui charge `/widget/app.js` et `/widget/app.css` à chaque ouverture. Un déploiement est ainsi visible sans rafraîchir le plugin. Voir [architecture](architecture.md).
