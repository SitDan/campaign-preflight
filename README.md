# Campaign Preflight

## Le client

L'équipe **marketing / marchés locaux** d'une marque internationale. Dans la démo, c'est **Maison Ardoise**, une marque fictive de prêt-à-porter qui diffuse ses campagnes Instagram en France, au Royaume-Uni et en Allemagne.

Deux profils l'utilisent :
- **le créatif**, avant d'envoyer le kit au media buyer ;
- **le media buyer**, avant de le mettre en ligne dans Meta.

## Pourquoi il l'installe

Les kits d'annonces (visuels, textes, plusieurs langues) partent souvent avec des erreurs : mauvais format, offre ou date fausse sur le visuel, mauvaise langue, champ manquant. Elles sont repérées tard, à la main, ou après un refus de Meta.

Campaign Preflight vérifie le kit **dans ChatGPT**, avant publication.

## Pourquoi ça vaut son temps

Pour un kit de 10 annonces, il obtient en moins d'une minute (environ 5 s par annonce, mesuré) :

- **à corriger** : les écarts aux règles Meta officielles (format, poids, dimensions, ratio), sourcées et datées, et les champs manquants ;
- **à vérifier** : les différences repérées par l'IA entre le texte du visuel et ses informations (langue, offre, collection, date) ;
- **l'e-mail de demande de corrections**, rédigé par ChatGPT et prêt à envoyer.

## Installer et essayer (2 min)

1. ChatGPT (web) → **Plugins** → **+** → **Add custom MCP server**.
2. Nom `Campaign Preflight`, URL `https://campaign-preflight.vercel.app/mcp`, **No authentication** → **Create** → **Connect**.
3. Dans un chat, lancer le prompt 1 ci-dessous, puis **Essayer avec la clé de démonstration** et **Essayer avec un exemple**.

Prérequis : un ChatGPT qui autorise les serveurs MCP personnalisés. Aucune clé n'est nécessaire pour tester. En usage réel, chacun utilise sa propre clé OpenAI, à moins d'un centime par annonce.

Trois prompts :

1. `@Campaign Preflight Vérifie mon kit Instagram Feed avant de l'envoyer au media buyer.`
2. `@Campaign Preflight Quelles règles Meta vérifies-tu pour une image Instagram Feed, et d'où viennent-elles ?`
3. Après « Rédiger l'e-mail de demande de corrections » : `Transforme ça en message Slack court pour l'équipe créative, avec un tableau des corrections par annonce.`

Sur le kit d'exemple, le résultat attendu est le suivant :

| Annonce | Résultat attendu |
|---|---|
| FR | rien à signaler |
| UK | offre fausse (30 % au lieu de 20 %) |
| DE | visuel en français au lieu d'allemand |

## Nos choix

- **Une app ChatGPT** : un serveur MCP et une interface dans le chat. Il n'y a pas de site à part, sauf la page sécurisée de saisie de clé.
- **Des règles Meta officielles**, lues sur les pages Meta, citées et datées. Une règle non vérifiée n'est jamais affichée comme « conforme ».
- **Une IA limitée à la lecture du texte des visuels**, avec ses résultats marqués « à vérifier ». Les contrôles techniques sont faits par le code.
- **La clé OpenAI de l'utilisateur.** Elle est saisie hors du chat, chiffrée et effacée au bout de 3 h. Une clé de démonstration plafonnée permet de tester sans configuration.
- **Le modèle `gpt-6-luna`**, choisi après une évaluation sur 6 cas annotés : même résultat que le modèle plus gros, pour un coût 18 fois plus faible.

## Avec une journée de plus

- **OAuth**, pour une seule connexion par utilisateur, sans ressaisie de clé.
- **Facebook Feed et Stories**, chacun avec ses règles Meta sourcées.

Ensuite :
- la vidéo ;
- le choix du modèle d'IA ;
- la création automatique des campagnes dans Meta à partir du kit validé (MCP ou API Marketing).

## Technique

- **Stack** : Next.js / TypeScript sur Vercel, MCP + MCP Apps, OpenAI (API Responses), Redis Upstash.
- **Vérification** : `pnpm install && pnpm check`, soit 79 tests.
- **Détails** : [développement](docs/developpement.md) · [architecture](docs/architecture.md) · [sécurité](docs/security.md) · [règles Meta](docs/rules.md) · [validation et coûts](docs/validation.md) · [fiche de présentation](docs/listing.md).
