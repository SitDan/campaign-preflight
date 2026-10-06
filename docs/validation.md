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
| Retour utilisateur intégré | miniatures cassées (URL `blob:` probablement bloquées par la CSP de l'hôte) ⇒ passage en `data:` ; interface jugée peu ergonomique ⇒ parcours guidé (déployé à 14:34) | captures |

Le téléchargement n'est pas annoncé par l'hôte : l'export passe par le repli « CSV intégral sélectionnable ». _Restent à confirmer dans ChatGPT : miniatures en `data:`, bouton d'aide CSV (déployé à 14:39, après le chargement du composant testé), parcours avec une vraie clé._

## 5. API réelle (vraie clé) et mini-évaluation

_À compléter :_ six cas (`evals/cases.json`, attendus rédigés avant exécution), détections, fausses alertes, abstentions, latence, jetons, coût estimé (tarif Standard `gpt-6.1-sol` lu le 2026-10-06 : 2,00 $/1M en entrée, 10,00 $/1M en sortie).

## 6. Décisions en cours de réalisation

| Heure | Décision (utilisateur) | Effet |
|---|---|---|
| 14:28 | L'interface est jugée peu ergonomique dans ChatGPT | Parcours guidé en 3 étapes, rapport « À corriger / À confirmer / Non vérifié » |
| 14:37 | Pas d'IA pour lire ou réparer le CSV | Diagnostics déterministes + bouton « Demander de l'aide à ChatGPT » (diagnostic seul, sans données) |
| 14:45 | On garde OpenAI, avec un seul modèle | Multi-fournisseur et OAuth notés pour la journée suivante |
| 14:53 | Sessions allongées : **3 h, 10 validations, 30 appels IA** (brief : 60 min, 3, 9) | Écart assumé au brief §3, justifié dans `docs/security.md` |
| 14:59 | Un seul envoi pour le CSV et les images | Sélecteur unique : répartition automatique CSV/images, fichiers d'autres formats ignorés et signalés |
| 14:56 | OAuth reporté après le P0 | Piste n°1 de la journée suivante : Descope MCP Auth (Marketplace Vercel), estimée à 1–1,5 jour au total ; compatibilité ChatGPT ↔ Descope à vérifier en premier |

## 7. Temps réel

| Jalon | Début | Fin | Notes |
|---|---|---|---|
| Lecture du cadrage, accès, recherches Meta/OpenAI | 13:28 | 13:41 | 3 recherches documentaires en parallèle |
| J0 socle, MCP, composant, déploiement | 13:41 | 13:47 | MCP déployé et testé de l'extérieur à 13:46 |
| J1 session, association, chiffrement, tests | 13:47 | 13:52 | 28 tests |
| J2 cœur (CSV, image, IA, run, rapport) | 13:52 | 14:01 | 67 tests au total |
| Composant complet, fixtures, éval, docs | 14:01 | 14:15 | Banc local de bout en bout |
| Attente d'accès : Redis | 14:15 | 14:16 | Acceptation des conditions Upstash par l'utilisateur |
| Déploiement de J1/J2 avec Redis, parcours API sur Vercel | 14:16 | 14:20 | |
| Preuve ChatGPT : ajout, rendu, origine réelle, CORS | 14:17 | 14:24 | Ajout du plugin et captures par l'utilisateur |
