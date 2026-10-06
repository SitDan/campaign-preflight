# Campaign Preflight

## Le client

L'équipe **marketing / marchés locaux** d'une marque internationale. Dans la démo, c'est **Maison Ardoise**, une marque fictive de prêt-à-porter qui diffuse ses campagnes Instagram en France, au Royaume-Uni et en Allemagne.

Deux profils l'utilisent : **le créatif**, avant d'envoyer le kit au media buyer, et **le media buyer**, avant la mise en ligne dans Meta.

## Pourquoi il l'installe

Pour vérifier son kit d'annonces **dans ChatGPT, avant publication**. Aujourd'hui, les erreurs (mauvais format, offre ou date fausse, mauvaise langue, champ manquant) sont repérées tard, à la main, ou après un refus de Meta.

## Pourquoi ça vaut son temps

Pour un kit de 10 annonces, en moins d'une minute (environ 5 s par annonce, mesuré), l'équipe obtient :

- **à corriger** : les écarts aux règles Meta officielles (format, poids, dimensions, ratio), sourcées et datées, et les champs manquants ;
- **à vérifier** : les différences repérées par l'IA entre le texte du visuel et ses informations (langue, offre, collection, date) ;
- **la synthèse et le message de corrections**, rédigés par ChatGPT.

## Installer et essayer (2 min)

Prérequis : un ChatGPT qui autorise les serveurs MCP personnalisés. Aucune clé n'est nécessaire pour tester.

1. ChatGPT (web) → **Plugins** → **+** → **Add custom MCP server**.
2. Nom `Campaign Preflight`, URL `https://campaign-preflight.vercel.app/mcp`, **No authentication** → **Create** → **Connect**.
3. Lancer les prompts ci-dessous.

| # | Prompt | Ce qui se passe |
|---|---|---|
| 1 | `@Campaign Preflight Vérifie mon kit Instagram Feed avant de l'envoyer au media buyer.` | L'app s'ouvre. Cliquer sur **Essayer avec la clé de démonstration**, puis **Essayer avec un exemple**, puis **Lancer la vérification**. À la fin, ChatGPT présente la synthèse. |
| 2 | `Rédige le message Slack pour l'équipe créative avec un tableau des corrections par annonce.` | ChatGPT rédige à partir des résultats, que l'app lui a partagés sans clé ni image. |
| 3 | `@Campaign Preflight Mon visuel fait 1080 × 1920 px : est-il accepté en Instagram Feed ? Cite la règle Meta.` | ChatGPT interroge l'outil des règles Meta et répond avec la source. |

Résultat attendu sur le kit d'exemple :

| Annonce | Résultat |
|---|---|
| FR | rien à signaler |
| UK | offre fausse (30 % au lieu de 20 %) |
| DE | visuel en français au lieu d'allemand |

En usage réel, chacun utilise sa propre clé OpenAI, pour moins d'un centime par annonce.

## Nos choix

- **Une app ChatGPT** : un serveur MCP et une interface dans le chat. La seule page externe sert à saisir la clé.
- **Des règles Meta officielles**, citées et datées. Une règle non vérifiée n'est jamais affichée comme « conforme ».
- **Une IA limitée à la lecture du texte des visuels**, dont les résultats sont marqués « à vérifier ». Les contrôles techniques sont faits par le code.
- **La clé OpenAI de l'utilisateur.** Elle est saisie hors du chat, chiffrée et effacée au bout de 3 h. Une clé de démonstration plafonnée sert aux essais.
- **Le modèle `gpt-6-luna`**, choisi après évaluation sur 6 cas annotés : même résultat que le modèle plus gros, pour un coût 18 fois plus faible.

## Avec une journée de plus

- **Préparer le kit depuis le chat** : un outil `prepare_kit` avec lequel ChatGPT transforme un brief en texte libre, ou un tableau mal formaté, en kit au bon format, validé par l'app.
- **OAuth**, pour une seule connexion par utilisateur, sans ressaisie de clé.
- **Facebook Feed et Stories**, chacun avec ses règles Meta sourcées.

Ensuite : la vidéo, le choix du modèle d'IA, et la création automatique des campagnes dans Meta à partir du kit validé (MCP ou API Marketing).

## Technique

- **Stack** : Next.js / TypeScript sur Vercel, MCP + MCP Apps, OpenAI (API Responses), Redis Upstash.
- **Vérification** : `pnpm install && pnpm check`, soit 80 tests.
- **Détails** : [fiche annuaire](docs/listing.md) · [développement](docs/developpement.md) · [architecture](docs/architecture.md) · [sécurité](docs/security.md) · [règles Meta](docs/rules.md) · [validation et coûts](docs/validation.md).
