# Campaign Preflight

## Problème

Les kits d'annonces (visuels et textes, en plusieurs langues) partent souvent sur Meta avec des erreurs : mauvais format, offre ou date fausse sur le visuel, mauvaise langue, champ manquant. Elles sont repérées tard, à la main, par le media buyer ou après un refus de Meta.

## Solution

Un outil intégré à ChatGPT qui vérifie un kit (un CSV et ses visuels) en environ 5 secondes par annonce :

- **contrôles techniques** des visuels par rapport aux règles Meta officielles, sourcées et datées ;
- **lecture du texte des visuels par l'IA**, comparée aux informations du CSV (langue, offre, collection, date) ;
- **résultat par annonce** (« À corriger », « À vérifier », « Rien à signaler »), puis rédaction par ChatGPT de l'e-mail de demande de corrections.

Il sert au créatif avant l'envoi au media buyer, et au media buyer avant la mise en ligne.

Le périmètre du POC couvre Instagram Feed, les images, 10 annonces par kit et 3 langues (FR, EN, DE).

L'analyse utilise la clé OpenAI de l'utilisateur et coûte moins d'un centime par annonce. La clé est chiffrée, conservée 3 h au plus et jamais saisie dans le chat.

## Installation (2 min)

Prérequis :
- ChatGPT web, avec un compte qui autorise les serveurs MCP personnalisés ;
- une clé API OpenAI avec accès à `gpt-6-luna`.

Étapes :
1. ChatGPT → **Plugins** → **+** → **Add custom MCP server**.
2. Nom `Campaign Preflight`, URL `https://campaign-preflight.vercel.app/mcp`, **No authentication** → **Create** → **Connect**.
3. Dans un chat : `@Campaign Preflight Ouvre Campaign Preflight pour vérifier mon kit Instagram Feed.`, puis suivre les 3 étapes affichées.

Le bouton « Essayer avec un exemple » charge un kit fictif. Résultat attendu :

| Annonce | Résultat |
|---|---|
| FR | rien à signaler |
| UK | erreur d'offre |
| DE | erreur de langue |

## Prochaines étapes

1. **Placements** : Facebook Feed, Stories, Reels.
2. **Vidéo**.
3. **OAuth** : une seule connexion, sans ressaisie de clé.
4. **Choix du modèle d'IA**, restreint à un seul modèle dans le POC.
5. **Création automatique des campagnes dans Meta** à partir du kit validé (MCP ou API Marketing de Meta).

À valider ensemble :
- kits de plus de 10 annonces ;
- contrôles de texte supplémentaires ;
- historique des vérifications ;
- veille des spécifications Meta ;
- évaluation sur des cas réels ;
- second fournisseur d'IA ;
- interface en anglais.

## Technique

- **Stack** : Next.js / TypeScript sur Vercel, serveur MCP avec composant MCP Apps, OpenAI (API Responses), Redis Upstash.
- **Lancer le projet** : `pnpm install && pnpm check`.
- **Détails** : [développement](docs/developpement.md) · [architecture](docs/architecture.md) · [sécurité](docs/security.md) · [règles Meta](docs/rules.md) · [validation et coûts](docs/validation.md).
