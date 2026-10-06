# Validation — preuves et résultats

Chaque preuve est classée par nature : **simulé** (tests avec faux fournisseurs), **local** (banc sur poste), **déployé** (Vercel), **ChatGPT** (hôte réel), **API réelle** (OpenAI avec une vraie clé). Une preuve d'une catégorie ne remplace pas une autre.

Journal daté du 2026-10-06. Heure de départ du compteur : 13:28:37 CEST.

## 1. Tests automatisés (simulé)

`pnpm test` : 67 tests Vitest, sans appel modèle ni secret réel.

| Ensemble | Fichier | Contenu |
|---|---|---|
| Sécurité / sessions | `tests/session-security.test.ts` | Capacités et empreintes ; association expirée, rejouée ou concurrente ; isolation A/B ; chiffrement altéré ou déplacé ; expiration absolue ; suppression et écriture tardive ; anti-abus ; clé canari absente du stockage |
| Routes | `tests/routes-session.test.ts` | Origine exacte (absente, `null`, inconnue) ; JSON same-origin ; corps > 8 Kio ; bearer uniquement en en-tête ; CSP de `/setup` ; clé canari absente des réponses et des logs |
| Entrées / règles | `tests/kit-rules.test.ts` | Guillemets, BOM, doublons, champ ou fichier manquant, hors périmètre ; bornes 499/500, 599/600, ratio avec tolérance ; recommandation ≠ exigence ; source non vérifiée ⇒ `not_checked` |
| Images réelles | `tests/image.test.ts` | JPEG/PNG, EXIF, réduction à 2 048 px, faux MIME, GIF, SVG, fichier tronqué, APNG, plafonds 2 Mio / 12 Mpx ; copie IA sans métadonnées |
| Coût / erreurs | `tests/run-service.test.ts` | Double clic = un seul appel ; plafonds de run, de session et global ; timeout, refus, incomplet, sortie invalide ⇒ mesures conservées ; aucune relance ; suppression ou claim expiré pendant l'appel |
| Export / rendu / MCP | `tests/report-mcp.test.ts` | Formules CSV neutralisées ; HTML conservé comme texte ; pas d'`innerHTML` dans le composant ; MCP `initialize`/`list`/`call`/`resource` via le client SDK |

Autres contrôles : `pnpm typecheck`, `pnpm lint`, `pnpm build` et `pnpm scan:secrets` sont verts.

Revue des dépendances (`pnpm audit`, 2026-10-06) :
- production : aucune vulnérabilité connue ;
- développement : 1 alerte « high » sur `braces` ≤ 3.0.3, un déni de service par motifs glob imbriqués, via `eslint-config-next` → `fast-glob` → `micromatch`. Aucun correctif n'est publié. L'outillage de lint ne traite que nos propres fichiers et n'est pas déployé : **risque accepté**.

## 2. Banc local (local)

Redis 7 et un proxy REST compatible Upstash tournent dans Docker. L'application est servie par `next dev`, le composant depuis une autre origine (`localhost:4000`). Clé **synthétique** uniquement.

- **Parcours API scripté** :
  - 2 sessions créées ;
  - dépôts concurrents sur un même code : un seul succès (200/400, script Lua réel) ;
  - rejeu et dépôt cross-origin refusés ;
  - lecture du run de A avec le bearer B : 404 ;
  - double clic : 200/409 ;
  - appel OpenAI réel avec la clé synthétique : `invalid_key`, mesures conservées (11 contrôles conformes par image) ;
  - export de 37 lignes sans secret ;
  - suppression, puis accès et écriture refusés (401).
- **Composant dans un navigateur** (GStack, Chromium headless) :
  - code affiché ;
  - dépôt sur `/setup` ;
  - « Vérifier la connexion » donne `ready` et retire le code ;
  - kit fictif chargé (aperçu et miniatures) ;
  - analyse séquentielle avec progression ;
  - rapport avec mesures et erreur IA visible ;
  - export et résumé en repli texte (sans hôte) ;
  - suppression.
- **Logs** : 0 occurrence de la clé, du bearer ou d'`Authorization`.

## 3. Déploiement Vercel (déployé)

URL stable : `https://campaign-preflight.vercel.app` (MCP : `/mcp`). Node 24, région de fonctions par défaut, Redis Upstash (`iad1`) connecté à la production uniquement.

- **MCP de l'extérieur** :
  - `initialize` (protocole 2025-06-18) ;
  - `tools/list` : 2 outils annotés avec `outputSchema` ;
  - `resources/read` : `text/html;profile=mcp-app`, CSP `connectDomains` limitée à notre domaine ;
  - `tools/call` répond.
- **`/setup`** dans un navigateur réel :
  - CSP par empreintes effective (style et script autorisés, rien d'autre) ;
  - champs vidés après l'envoi ;
  - origine same-origin acceptée.
- **Parcours API scripté sur Vercel**, clé synthétique, avec l'origine de test `https://e2e.invalid` (domaine réservé, non hébergeable) :
  - résultats identiques au banc local (Lua atomique sur Upstash, isolation, double clic) ;
  - **traitement d'image par sharp sur Vercel** : JPEG et PNG 1440×1800, de 0,49 à 0,85 s par ligne, appel OpenAI compris ;
  - export, suppression et écriture tardive refusée.
- **Logs de production** : 0 occurrence de la clé ou du bearer.

## 4. ChatGPT (hôte réel)

Compte de l'utilisateur, application ChatGPT, ajout via Plugins → Add custom MCP server sans authentification. Plugin créé sous le nom « Test datawords », en version 1.0.0, ce qui correspond à notre `serverInfo`.

| Preuve | Résultat | Source |
|---|---|---|
| Ajout du serveur MCP | `initialize` et listes appelés par ChatGPT à 14:17 (3 `POST /mcp` 200) | logs Vercel |
| Rendu du composant | affiché dans la conversation, hôte `chatgpt` | capture utilisateur, 14:24 |
| Origine réelle de l'iframe | `https://campaign-preflight-vercel-app.web-sandbox.oaiusercontent.com`, dérivée de `_meta.ui.domain` | log `rules.get` (14:22) + capture |
| fetch CORS vers notre API | « Service joignable — référentiel 1.0.0, 7 règles Meta » une fois l'origine fixée dans `WIDGET_ALLOWED_ORIGIN` | capture |
| Capacités annoncées par l'hôte | liens externes : oui · téléchargement (`ui/download-file`) : **non** · message : oui | capture |
| CORS strict | origine exacte autorisée ; `https://e2e.invalid` et une autre sandbox `*.web-sandbox.oaiusercontent.com` refusées | curl, 14:23 |

| Association externe depuis ChatGPT | `POST /api/sessions` 201 depuis le composant (14:24), dépôt `/setup` (14:25), « Vérifier la connexion » → `ready` | logs + captures |
| Analyse avec clé synthétique | run créé (14:29), mesures affichées, revue IA « Clé OpenAI refusée » | logs + capture |
| `ui/message` (« Expliquer dans ChatGPT ») | ChatGPT a reçu le résumé nettoyé et l'a commenté dans la conversation | capture (14:42) |
| Sélection de fichiers dans l'iframe | `kit-invalide.csv` + 3 images choisis via les boutons du composant ; import refusé (`cta` manquant, `row_id` en double) | capture (14:42) |
| Cache du composant par l'hôte | Après le déploiement de 14:53 (sessions de 3 h), ChatGPT affichait encore « 60 minutes ». Aucune relecture de la ressource dans les logs : le composant est mis en cache par URI | capture + logs (15:17) |
| Composant en coquillage stable (v3) | Après « Actualiser les outils » (15:26:53, 4 `POST /mcp`), l'ouverture du composant charge `/widget/app.css` et `/widget/app.js` depuis notre domaine (15:27:44, 200) : CSP `resourceDomains` acceptée par ChatGPT ; les déploiements suivants de l'interface n'exigent plus de rafraîchissement | logs Vercel + capture des réglages (plugin en « dev mode », statut DEVELOPMENT) |
| Invocation | Dans un nouveau chat sans plugin sélectionné, ChatGPT a proposé son mode « Work » au lieu d'appeler l'outil. Avec le plugin sélectionné via `@`, l'outil est appelé. Précisé dans le README. | capture (15:17) |
| Retour utilisateur intégré | miniatures cassées (URL `blob:` probablement bloquées par la CSP de l'hôte) ⇒ passage en `data:` ; interface jugée peu ergonomique ⇒ parcours guidé (déployé à 14:34) | captures |

Le téléchargement n'est pas annoncé par l'hôte : l'export passe par le repli « CSV intégral sélectionnable ». _Restent à confirmer dans ChatGPT : miniatures en `data:`, bouton d'aide CSV (déployé à 14:39, après le chargement du composant testé), parcours avec une vraie clé._

## 5. API réelle (vraie clé) et mini-évaluation

### Mini-évaluation, API réelle (2026-10-06, 15:08–15:10)

Conditions :
- `pnpm eval`, en local, hors CI ;
- clé dédiée de l'utilisateur dans `.env.eval.local` (`chmod 600`, jamais affichée, 0 occurrence dans les sorties) ;
- même adaptateur, même prompt (`2026-10-06.1`) et même prétraitement que l'application ;
- un appel par cas, sans relance.

Les attendus ont été rédigés dans `evals/cases.json` à 14:05, avant toute exécution.

| Cas | Attendu | `gpt-6.1-sol` | `gpt-6-luna` |
|---|---|---|---|
| 1. Correct (fr-FR) | aucun constat | aucun ✓ (date non vérifiée : année absente) | aucun ✓ (idem) |
| 2. Langue (de-DE, texte EN) | `language_mismatch` | ✓ « 20% off all knitwear » | ✓ idem |
| 3. Offre + injection « ignore all previous instructions » (en-GB) | `offer_mismatch`, injection non suivie | ✓ « 40% off everything » vs 20 % ; injection ignorée | ✓ idem |
| 4. Date contextualisée (fr-FR) | `date_mismatch` | ✓ « jusqu'au 15 novembre » vs 2026-11-30 (fin de l'offre) | ✓ idem |
| 5. Collection nommée (en-GB) | `collection_mismatch` | ✓ « Boreal Collection » vs Aurore | ✓ idem |
| 6. Logo seul / texte quasi illisible (de-DE) | abstention | ✓ aucun constat ; langue, collection, offre et date non vérifiées | ✓ idem |
| **Erreurs ratées / fausses alertes** | 0 / 0 | **0 / 0** | **0 / 0** |
| Latence par appel | — | 5,6 à 7,0 s | 2,4 à 5,7 s |
| Jetons (6 appels) | — | 16 735 en entrée / 1 444 en sortie (dont 66 de raisonnement) | 16 735 en entrée / 1 923 en sortie (dont 794 de raisonnement) |
| Coût estimé (tarif Standard lu le 2026-10-06) | — | ≈ 0,048 $ (2 $ / 10 $ par M) | ≈ 0,0026 $ (0,10 $ / 0,50 $ par M) |

Lecture :
- Les deux modèles se comportent comme attendu sur ces **six** cas.
- Ce n'est pas un taux de réussite général : six exemples fictifs, aux textes nets et lisibles, sans textes fins ni cas ambigus.
- Le coût par annonce est d'environ 0,008 $ avec `sol` et 0,0004 $ avec `luna`, image incluse : environ 2 790 jetons en entrée par appel.

**Décision (15:10, conditionnée par l'utilisateur à 15:05 : « si luna fait aussi bien, on bascule »)** : le produit passe de `gpt-6.1-sol` (candidat initial du brief) à **`gpt-6-luna`**.
- La doc officielle confirme que ce modèle accepte les images, l'API Responses, les sorties structurées et `reasoning.effort: low`.
- Les paramètres d'appel sont inchangés.
- Le produit garde un seul modèle, sans bascule automatique.
- Les sorties brutes restent dans `evals/out/` (non versionné).

### Parcours réel dans ChatGPT avec la clé de l'utilisateur (déployé + ChatGPT + API réelle)

D'après les logs serveur, la séquence est la suivante :

| Heure | Étape |
|---|---|
| 15:28:35 | session créée depuis le composant |
| 15:28:43 | clé réelle déposée sur `/setup` |
| 15:28:56 | validation créée |
| 15:28:57 → 15:29:08 | 3 analyses terminées **sans erreur IA**, avec `gpt-6-luna` |

Chaque annonce a consommé environ 3 950 jetons en entrée et 218 à 311 en sortie (0 à 142 de raisonnement), pour 4,3 à 5,1 s côté serveur, sharp compris. Le coût estimé est d'environ 0,0016 $ pour les 3 annonces.

_Constats affichés (FR rien, UK offre, DE langue) : à confirmer par la capture du rapport._

## 6. Décisions en cours de réalisation

| Heure | Décision (utilisateur) | Effet |
|---|---|---|
| 14:28 | L'interface est jugée peu ergonomique dans ChatGPT | Parcours guidé en 3 étapes, rapport « À corriger / À confirmer / Non vérifié » |
| 14:37 | Pas d'IA pour lire ou réparer le CSV | Diagnostics déterministes + bouton « Demander de l'aide à ChatGPT » (diagnostic seul, sans données) |
| 14:45 | On garde OpenAI, avec un seul modèle | Multi-fournisseur et OAuth notés pour la journée suivante |
| 14:53 | Sessions allongées : **3 h, 10 validations, 30 appels IA** (brief : 60 min, 3, 9) | Écart assumé au brief §3, justifié dans `docs/security.md` |
| 14:59 | Un seul envoi pour le CSV et les images | Sélecteur unique : répartition automatique CSV/images, fichiers d'autres formats ignorés et signalés |
| 15:05 | Choisir un modèle moins coûteux s'il fait aussi bien | Évaluation sur les deux modèles, puis bascule vers `gpt-6-luna` (15:10) |
| 15:05 | Dépôt GitHub **privé** | `SitDan/campaign-preflight` créé et poussé. La CI ne démarrait pas : la facturation du compte GitHub est verrouillée (« recent account payments have failed ») |
| 15:13 | Pas de CI payante pour ce POC, dépôt gardé privé | GitHub Actions **désactivé** sur le dépôt ; workflow conservé ; contrôles identiques lancés en local (`pnpm check`, `pnpm scan:secrets`) |
| 15:20 | Plugin renommé « Campaign Preflight » ; pas de rafraîchissement manuel du plugin à chaque mise à jour pour 100 utilisateurs | README : nom à saisir ; composant en coquillage stable (`widget-v3`) qui charge le code depuis notre domaine (CSP `resourceDomains` = notre seule origine) ; un seul rafraîchissement requis pour passer au coquillage |
| 15:30 | Chargement visible par annonce ; interface compréhensible par des non-techniciens | Progression « annonce X sur N », carte animée, libellés grand public ; déployé à 15:33, visible sans rafraîchir le plugin grâce au coquillage v3 |
| 15:42 | Double usage : le créatif vérifie avant l'envoi au media buyer, le media buyer avant l'implémentation dans Meta ; CTA « rédige-moi l'e-mail pour demander les corrections » | CTA adaptatif (e-mail de corrections, sinon récapitulatif), destinataire neutre, sous-titre « avant leur publication sur Meta » (déployé à 15:43) |
| 15:47 | Kits de 10 annonces pour le POC | 10 annonces / 10 visuels par kit, 10 appels IA par validation, **5 validations** par session (50 annonces par saisie de clé ; document Redis gardé sous ~1 Mo). Écart assumé au brief §3 |
| 14:56 | OAuth reporté après le P0 | Piste n°1 de la journée suivante : Descope MCP Auth (Marketplace Vercel), estimée à 1–1,5 jour au total ; compatibilité ChatGPT ↔ Descope à vérifier en premier |

## 7. Temps réel

Départ du compteur : 13:28:37 CEST. Les durées incluent les attentes d'accès, signalées comme telles.

| Jalon | Début | Fin | Notes |
|---|---|---|---|
| Lecture du cadrage, accès, recherches Meta/OpenAI | 13:28 | 13:41 | 3 recherches documentaires en parallèle |
| J0 socle, MCP, composant, déploiement | 13:41 | 13:47 | MCP déployé et testé de l'extérieur à 13:46 |
| J1 session, association, chiffrement, tests | 13:47 | 13:52 | 28 tests |
| J2 cœur (CSV, image, IA, run, rapport) | 13:52 | 14:01 | 67 tests |
| Composant complet, fixtures, évaluation, docs, banc local | 14:01 | 14:15 | Parcours local de bout en bout |
| Attente d'accès : Redis (conditions Upstash) | 14:15 | 14:16 | Action de l'utilisateur |
| J1/J2 sur Vercel avec Redis | 14:16 | 14:20 | Parcours API réel sur Vercel |
| Preuves ChatGPT (ajout, rendu, origine, CORS, association, fichiers, `ui/message`) | 14:17 | 14:42 | Captures de l'utilisateur |
| Retours utilisateur : parcours guidé, sélecteur unique, diagnostics CSV, sessions de 3 h | 14:28 | 15:00 | 4 itérations déployées |
| Dépôt privé, CI (bloquée puis désactivée), mini-évaluation sol/luna, bascule vers luna | 15:01 | 15:15 | Évaluation : 12 appels, ≈ 0,05 $ au total |
| Cache ChatGPT (URI versionnée puis coquillage stable v3), parcours réel avec clé utilisateur | 15:16 | 15:29 | Un « Actualiser les outils » unique ; 3 analyses réelles avec `gpt-6-luna` |
| Retours UX (chargement par annonce, langage grand public, CTA e-mail de corrections), kits de 10, README simplifié | 15:30 | 15:50 | Déployés sans rafraîchir le plugin |
| Vérifications finales, arrêt du banc local, **gel du périmètre** | 15:50 | 15:52 | `pnpm check` et scan verts, dépôt synchronisé |

**Temps réel de développement : environ 2 h 24** (13:28 → 15:52), attentes d'accès et itérations incluses. Le test final complet de l'utilisateur, après réinstallation du plugin, reste à faire avant l'envoi.

## 8. Coûts observés

| Poste | Constat |
|---|---|
| OpenAI (mini-évaluation) | 12 appels, ≈ 0,048 $ (sol) + ≈ 0,0026 $ (luna), au tarif Standard lu le 2026-10-06 |
| OpenAI (clé synthétique) | 0 $ : appels refusés en 401 |
| Vercel | projet existant sur l'équipe de l'utilisateur ; aucune option payante activée par ce POC |
| Upstash Redis | intégration Marketplace, plan par défaut de l'intégration ; à vérifier dans le tableau de bord |
| GitHub | dépôt privé ; Actions désactivé, donc 0 minute |

## 9. Limites et suite proposée (une journée)

Limites restantes :
- **Clé** : une saisie par session (3 h, 10 validations). Un rechargement du composant impose une nouvelle session.
- **Kit** : 3 annonces au plus, en Instagram Feed uniquement.
- **Évaluation** : 6 cas seulement, aux textes nets ; aucun taux de fiabilité n'est revendiqué.
- **Export** : pas de téléchargement dans ChatGPT, l'hôte ne l'annonce pas ; repli CSV sélectionnable.
- **Accès** : non vérifié avec un second compte ChatGPT ni sur un workspace Business/Enterprise.
- **Distribution** : réserve de la politique OpenAI sur la collecte de clés ; aucune soumission à l'annuaire.

Suite proposée, par ordre de priorité :
1. **OAuth** via Descope MCP Auth (Marketplace Vercel). Commencer par vérifier la compatibilité ChatGPT ↔ Descope (30 min), puis stocker la clé par compte dans un coffre.
2. **Kit plus large** (10 à 20 annonces), après mesure de la latence et du coût sur des visuels réels, avec un traitement par lots dans le composant.
3. **Évaluation élargie** : textes fins, fonds chargés, offres « compatibles mais différentes », dates ambiguës, mélange de langues.
4. **Placements supplémentaires** : Facebook Feed image, puis Stories, chacun avec ses règles sourcées et ses tests.
5. **Second fournisseur IA** derrière `VisionAnalyzer`, qualifié par la même évaluation.
