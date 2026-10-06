# Campaign Preflight

**Repérez les erreurs dans vos annonces Instagram Feed avant leur publication sur Meta.**

Campaign Preflight est un POC qui fonctionne dans ChatGPT. Il sert à deux moments :
- **côté créatif**, pour vérifier le kit avant de l'envoyer au media buyer ;
- **côté media buyer**, pour le vérifier avant de l'implémenter dans Meta.

On y dépose un petit kit d'annonces (CSV imposé + images) et on obtient :

- **les mesures techniques certaines** de chaque image : format, poids, dimensions, ratio. Elles sont comparées aux exigences et recommandations **Meta sourcées et datées**, séparées des limites propres au POC ;
- **les anomalies du kit** : champ obligatoire vide, image absente, locale ou placement hors périmètre, URL non HTTPS ;
- **des alertes IA « à confirmer »** sur le texte visible de l'image, lorsqu'il contredit une référence explicite du CSV (langue attendue, offre, collection nommée, date contextualisée) ;
- **la liste de ce qui n'a pas été vérifié**.

Le produit ne juge pas le style, ne certifie pas la conformité juridique et ne promet pas l'approbation de Meta. Il n'y a ni score global ni badge « validé ».

## Périmètre du POC

| | |
|---|---|
| Placement | Instagram Feed uniquement |
| Médias | images JPEG / PNG statiques (2 Mio, 12 Mpx, grand côté 6 000 px au maximum) |
| Kit | 3 annonces et 3 images au maximum, CSV ≤ 64 Kio |
| Locales | fr-FR, en-GB, de-DE |
| Session | 3 heures au plus, 10 validations, 30 appels IA (une saisie de clé par session) |

Hors périmètre : vidéo, carrousels, autres placements, compte ou API Meta, publication, réécriture, traduction, historique.

## Utiliser le service hébergé

### Prérequis

- **ChatGPT sur le web**, avec un compte ou un workspace qui autorise l'ajout d'un serveur MCP personnalisé. Les politiques de workspace s'appliquent : tous les comptes ne le permettent pas.
- **Votre propre clé API OpenAI**, avec du crédit API et l'accès au modèle `gpt-6-luna`. Les analyses sont facturées sur votre compte API, **séparément de l'abonnement ChatGPT**. Une validation de 3 annonces fait au plus 3 appels.

### Installation dans ChatGPT

1. Ouvrez **Plugins**, cliquez sur **+**, puis **Add custom MCP server**.
2. Saisissez le nom **`Campaign Preflight`**, l'URL `https://campaign-preflight.vercel.app/mcp` et l'authentification **No authentication**.
3. Validez l'avertissement, puis **Create as a plugin**, et cliquez sur **Connect**.

Le nom choisi est celui que l'on tape après `@`. Les exemples ci-dessous supposent « Campaign Preflight ». Avec un autre nom, remplacez-le par le vôtre.

### Parcours

1. Dans une conversation, envoyez : **`@Campaign Preflight Ouvre Campaign Preflight pour vérifier mon kit Instagram Feed.`** Le `@` active le plugin dans la conversation. Sans lui, ChatGPT peut proposer son mode « Work » (navigateur) : choisissez « Stay in Chat ».
2. Dans le composant, cliquez sur **Configurer ma clé**. Un code d'association s'affiche (usage unique, 10 minutes).
3. **Ouvrez la page de configuration** (`/setup`). Saisissez **le code affiché dans votre composant** et votre clé API. Ne collez jamais ces valeurs dans la conversation.
4. De retour dans ChatGPT, cliquez sur **Vérifier la connexion**. La clé est enregistrée mais pas testée : la première analyse vérifiera l'accès au modèle.
5. Cliquez sur **Choisir les fichiers du kit** et sélectionnez en une fois le CSV et ses images (par exemple tout le dossier), ou cliquez sur **Utiliser le kit d'exemple**. Contrôlez l'aperçu.
6. Cliquez sur **Analyser les N annonces**. Ce clic autorise au plus N appels facturés et l'envoi d'une copie réduite de chaque image à OpenAI.
7. Lisez les résultats. S'il y a des points à corriger, cliquez sur **Rédiger l'e-mail de demande de corrections** : ChatGPT rédige l'e-mail sous le composant, que vous relisez et envoyez vous-même. Vous pouvez aussi récupérer le rapport en CSV.
8. Cliquez sur **Terminer et supprimer** pour retirer la clé chiffrée et les résultats. Sinon, tout expire 3 heures après la création.

Si le composant est rechargé, la session est perdue : recommencez à l'étape 2. Supprimer la session ne révoque pas votre clé chez OpenAI.

### Trois prompts

1. « Ouvre Campaign Preflight pour vérifier mon kit Instagram Feed. »
2. « Quelles vérifications Instagram Feed sont couvertes et quelles sont leurs limites ? »
3. Après avoir partagé le résumé depuis le composant : « Explique les anomalies de ce rapport et les corrections à demander à l'agence. »

## Kit fictif et CSV imposé

Le dossier `fixtures/demo/` contient la marque fictive « Maison Ardoise » et sa collection « Aurore » :

| Fichier | Rôle |
|---|---|
| `kit.csv` | 3 annonces valides : FR **correcte**, UK avec **offre contradictoire** (30 % visible contre 20 % de référence), DE avec **erreur de langue** (visuel en français) |
| `aurore-fr.jpg`, `aurore-uk.jpg`, `aurore-de.png` | visuels 1440×1800 (4:5) |
| `kit-invalide.csv` | import refusé : colonne `cta` manquante, `row_id` en double |
| `kit-excel-fr.csv` | même kit exporté avec « ; » (Excel FR) : refusé avec diagnostic et bouton « Demander de l'aide à ChatGPT » |
| `modele.csv` | modèle vide avec toutes les colonnes |

Colonnes du CSV (UTF-8, BOM accepté, séparateur virgule, en-têtes exacts) :

| Colonne | Contrat |
|---|---|
| `row_id`, `ad_name` | obligatoires (`row_id` unique) |
| `locale` | `fr-FR`, `en-GB` ou `de-DE` |
| `placement` | `instagram_feed` |
| `media_filename` | nom exact de l'image, sans chemin ni URL |
| `primary_text`, `cta` | obligatoires selon le contrat de kit du POC (pas une obligation Meta universelle) |
| `landing_url` | HTTPS, sans identifiants ; syntaxe seule, aucune visite |
| `reference_collection`, `reference_offer` | facultatives : références approuvées pour **cette** ligne |
| `reference_date` + `reference_date_label` | facultatives : date ISO `AAAA-MM-JJ` et son rôle (ex. « fin de l'offre ») |

Une colonne inconnue ou une image non référencée produit un avertissement et une exclusion. Ce n'est jamais traité comme une instruction.

## Documentation

- [docs/architecture.md](docs/architecture.md) : flux, frontières, session éphémère, limites.
- [docs/security.md](docs/security.md) : chiffrement, rétention, sous-traitants, suppression, réserve BYOK et distribution.
- [docs/rules.md](docs/rules.md) : valeurs Meta vérifiées (URL, section, date), divergences, limites du POC.
- [docs/validation.md](docs/validation.md) : preuves locales, déployées, ChatGPT et API réelle ; six cas d'évaluation ; temps réel.
- [docs/listing.md](docs/listing.md) : fiche de présentation, brouillon non soumis.

## Développement

Stack : Next.js 16 (App Router), TypeScript 6 strict, Node.js 24, pnpm 10, SDK MCP v2 (`@modelcontextprotocol/server`, `ext-apps`, `mcp-handler`), Zod 4, csv-parse, sharp, SDK OpenAI (Responses), Upstash Redis, Vitest. Versions figées par `pnpm-lock.yaml`.

```bash
nvm use 24          # ou toute installation de Node 24
pnpm install --frozen-lockfile
pnpm check          # typecheck + lint + tests + build
pnpm dev            # nécessite .env.development.local (voir .env.example)
```

| Commande | Rôle |
|---|---|
| `pnpm test` | tests Vitest (sans appel modèle ni secret réel) |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | contrôles statiques et build (le composant est construit par esbuild avant) |
| `pnpm scan:secrets` | recherche de secrets dans les fichiers versionnés |
| `pnpm audit --prod` | revue des dépendances de production (aucune vulnérabilité connue au 2026-10-06) |
| `pnpm fixtures` | régénère le kit fictif et les visuels d'évaluation |
| `pnpm eval` | mini-évaluation **API réelle**, locale et hors CI (6 appels au plus) |

### Mises à jour du composant

ChatGPT met en cache le HTML du composant. Ce HTML est donc un **coquillage minimal et stable**, qui charge à chaque ouverture le code réel depuis notre domaine (`/widget/app.js`, `/widget/app.css`, revalidés par ETag).

Conséquence : un déploiement est servi immédiatement à tous les utilisateurs, sans rafraîchir le plugin. Seul un changement du coquillage ou de la définition des outils (nouvelle URI `ui://…/widget-vN`) exige que chaque utilisateur rafraîchisse le plugin.

La documentation OpenAI, lue le 2026-10-06, ne prévoit pas de purge automatique pour un serveur MCP personnalisé :
- « Treat the resource URI as a cache key… publish a new URI and update every tool that references it » (guide *ChatGPT UI*) ;
- « Refresh the plugin connection after each change to the MCP server (tools, metadata, and related configuration)… from the detail page at chatgpt.com/plugins » (*App quickstart*).

On garde donc des outils et des schémas rétrocompatibles, et le code du composant est chargé depuis notre domaine, déclaré dans `resourceDomains`.

### Intégration continue

`.github/workflows/ci.yml` décrit la chaîne : lockfile figé, types, lint, tests, build et scan de secrets. Son exécution est **désactivée sur le dépôt privé**, par choix de coût. Les mêmes contrôles se lancent en local : `pnpm check && pnpm scan:secrets`.

### Configuration serveur

Les variables sont décrites dans `.env.example`, avec des noms et des valeurs fictives uniquement :

- `APP_ORIGIN`, `WIDGET_ALLOWED_ORIGIN` (origines exactes du composant), `WIDGET_DOMAIN` ;
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash via Vercel Marketplace) ;
- `BYOK_ENCRYPTION_KEY_B64` (32 octets aléatoires, secret distinct de Redis), `BYOK_ENCRYPTION_KEY_ID` ;
- `APP_ENV`, `OPENAI_MODEL`, `DEMO_ENABLED`, et en option les plafonds anti-abus.

Le déploiement ne contient **aucune** `OPENAI_API_KEY` partagée. Les fichiers `.env*` (sauf `.env.example`) et `.local-spec/` sont ignorés par Git.

### Mini-évaluation

Créez vous-même `.env.eval.local`, contenant uniquement `OPENAI_API_KEY=…`, puis `chmod 600 .env.eval.local` et `pnpm eval`. Pour comparer un autre modèle sur les mêmes cas : `EVAL_MODEL=gpt-6-luna pnpm eval`. Le script utilise le même adaptateur, le même prompt et le même prétraitement que l'application. Il fait un appel par cas, sans relance. Il affiche les détections, les fausses alertes, les abstentions, la latence et les jetons, et écrit le détail dans `evals/out/` (non versionné).
