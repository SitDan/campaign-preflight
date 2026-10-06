# Règles Instagram Feed (images) — sources vérifiées

Référentiel : `rules/instagram-feed.json`, version 1.0.0. Le serveur le valide au chargement. Chaque validation (run) fige sa version.

## Sources officielles lues le 2026-10-06

| Source | URL | Accès constaté |
|---|---|---|
| Meta Ads Guide — Instagram Feed, image | https://www.facebook.com/business/ads-guide/update/image/instagram-feed | HTTP 200 sans connexion (récupération HTML directe), sans date sur la page |
| Documentation développeur Meta — Media Requirements (API Ads Instagram) | https://developers.facebook.com/documentation/ads-commerce/instagram/ads-api/reference/media-requirements | HTTP 200 sans connexion |

Lors d'une consultation antérieure, la page Ads Guide redirigeait vers une connexion. Le 2026-10-06, elle était lisible publiquement. Les libellés ci-dessous ont été extraits du HTML récupéré. Aucune valeur ne provient de la mémoire d'un modèle.

## Exigences Meta appliquées (`meta_requirement`)

| Règle | Contrôle | Citation (section) |
|---|---|---|
| `meta.req.aspect_ratio` | ratio largeur/hauteur entre 0,8 (4:5) et 1,91 (1,91:1), avec la tolérance publiée de 1 % (0,792 à 1,929) | « Minimum Aspect Ratio: 400 x 500 · Maximum Aspect Ratio: 191 x 100 · Aspect Ratio Tolerance: 1% » (Technical Requirements) |
| `meta.req.min_width` | largeur ≥ 500 px | « Minimum Width: 500 pixels » (Technical Requirements) |
| `meta.req.api_min_width` | largeur ≥ 600 px | « We require all images and videos to have at least a 600px width, independent of the ad's placement. » (doc développeur, Size) |
| `meta.req.max_file_size` | poids ≤ 30 MB, lu de façon prudente comme 30 × 10⁶ octets | « Maximum File Size: 30MB » (Technical Requirements) |

## Recommandations Meta (`meta_recommendation`)

Un écart est signalé comme « écart (recommandation) », jamais comme un rejet.

| Règle | Contrôle | Citation |
|---|---|---|
| `meta.rec.file_type` | JPG ou PNG | « Image File Type: JPG or PNG » (Design Recommendations) |
| `meta.rec.resolution` | largeur ≥ 1440 px. C'est **notre lecture** de « 1440 x 1800 pixels » (pour le ratio 4:5). | « Resolution: 1440 x 1800 pixels » (Design Recommendations) |
| `meta.rec.primary_text` | texte principal ≤ 125 caractères (risque de troncature) | « Primary Text: 125 characters » (Text Recommendations) |

## Divergences et éléments non contrôlés

- **Ratio recommandé** : 4:5 dans l'Ads Guide, 1:1 dans la documentation développeur. Les sources se contredisent, cette recommandation n'est donc **pas contrôlée**.
- **Largeur minimale** : 500 px dans l'Ads Guide, 600 px dans la doc API. Les deux règles sont affichées avec leur source.
- **Non contrôlés** :
  - titre : ce kit n'a pas de champ titre ;
  - hashtags : « Maximum Number of Hashtags: 30 » n'est pas implémenté ;
  - limite de 2 200 caractères de légende (doc API) : non pertinente, nos champs sont limités à 1 000 caractères ;
  - politiques publicitaires, rendu réel dans Instagram, approbation par Meta.
- La couverture format, ratio et résolution est assurée par des règles vérifiées. Le produit n'affiche pas pour autant de badge « conforme » ni de score.

## Limites du POC (`poc_limit`) — pas des règles Meta

| Règle | Valeur |
|---|---|
| `poc.format` | JPEG ou PNG statique, reconnu par signature puis décodage |
| `poc.file_bytes` | ≤ 2 Mio |
| `poc.pixels` | ≤ 12 millions de pixels |
| `poc.long_side` | grand côté ≤ 6 000 px |

Un dépassement signifie « non pris en charge par ce POC ». Les autres plafonds (CSV, sessions, tentatives IA) sont centralisés dans `src/config/limits.ts`.

## Contrat de kit (ni Meta, ni POC technique)

La présence de `primary_text`, `cta` et `landing_url` est exigée par **notre** contrat de kit. Ce n'est pas une obligation Meta universelle. `landing_url` doit être en HTTPS et sans identifiants. Seule sa syntaxe est contrôlée : aucune page n'est visitée.

## Mise à jour

Pour réviser une règle :
1. relire la source ;
2. mettre à jour `verifiedAt`, `quote` et la valeur dans `rules/instagram-feed.json` ;
3. incrémenter `version` ;
4. lancer `pnpm test`.

Une règle Meta dont `verifiedAt` est `null` produit toujours `not_checked`, jamais `pass`.
