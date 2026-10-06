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

_À compléter :_ rendu du composant, origine réelle de l'iframe, fetch CORS, sélection de fichiers, ouverture de `/setup`, téléchargement ou repli, message dans la conversation.

## 5. API réelle (vraie clé) et mini-évaluation

_À compléter :_ six cas (`evals/cases.json`, attendus rédigés avant exécution), détections, fausses alertes, abstentions, latence, jetons, coût estimé (tarif Standard `gpt-6.1-sol` lu le 2026-10-06 : 2,00 $/1M en entrée, 10,00 $/1M en sortie).

## 6. Temps réel

| Jalon | Début | Fin | Notes |
|---|---|---|---|
| Lecture du cadrage, accès, recherches Meta/OpenAI | 13:28 | 13:41 | 3 recherches documentaires en parallèle |
| J0 socle, MCP, composant, déploiement | 13:41 | 13:47 | MCP déployé et testé de l'extérieur à 13:46 |
| J1 session, association, chiffrement, tests | 13:47 | 13:52 | 28 tests |
| J2 cœur (CSV, image, IA, run, rapport) | 13:52 | 14:01 | 67 tests au total |
| Composant complet, fixtures, éval, docs | 14:01 | 14:15 | Banc local de bout en bout |
| Attente d'accès : Redis | 14:15 | 14:16 | Acceptation des conditions Upstash par l'utilisateur |
| Déploiement de J1/J2 avec Redis, parcours API sur Vercel | 14:16 | 14:20 | |
