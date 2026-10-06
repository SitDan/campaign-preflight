# Campaign Preflight

**Vérifiez vos annonces Instagram Feed avant leur publication sur Meta**, directement dans ChatGPT.

L'outil sert à deux moments :
- **côté créatif**, avant l'envoi du kit au media buyer ;
- **côté media buyer**, avant l'implémentation dans Meta.

## Ce que fait l'outil

Vous déposez un kit : un tableau CSV et les visuels. Pour chaque annonce, l'outil indique :
- **À corriger** : format, poids, dimensions, ratio, comparés aux règles Meta officielles (sourcées et datées), plus les champs manquants du kit ;
- **À vérifier** : les différences repérées par l'IA entre le texte visible du visuel et vos informations (langue, offre, collection, date) ;
- **Non vérifié** : ce que l'outil n'a pas pu contrôler.

Ensuite, ChatGPT peut **rédiger l'e-mail de demande de corrections**.

L'outil ne juge pas la créativité, ne certifie pas la conformité juridique et ne garantit pas l'approbation de Meta.

**Périmètre du POC** : Instagram Feed, images JPEG/PNG, **10 annonces par kit**, locales fr-FR, en-GB et de-DE.

## Installation dans ChatGPT

Prérequis : ChatGPT sur le web, avec un compte autorisé à ajouter un serveur MCP personnalisé, et **votre propre clé API OpenAI** (crédit API, accès à `gpt-6-luna`).

1. **Plugins** → **+** → **Add custom MCP server**.
2. Nom : **`Campaign Preflight`** · URL : `https://campaign-preflight.vercel.app/mcp` · Authentification : **No authentication**.
3. **Create as a plugin**, puis **Connect**.

Le nom choisi est celui que l'on tape après `@`.

## Utilisation

1. Dans une conversation : **`@Campaign Preflight Ouvre Campaign Preflight pour vérifier mon kit Instagram Feed.`**
2. **Connecter votre compte OpenAI** : un code s'affiche. Ouvrez la page sécurisée, saisissez le code et votre clé, puis revenez cliquer sur **C'est fait**.
3. **Choisir mes fichiers** : sélectionnez en une fois le CSV et ses visuels. Vous pouvez aussi cliquer sur **Essayer avec un exemple**.
4. **Lancer la vérification**, puis lisez les résultats.
5. **Rédiger l'e-mail de demande de corrections** ou **Récupérer le rapport (CSV)**. Terminez par **Terminer et supprimer mes données**.

Prompts utiles :
- « Ouvre Campaign Preflight pour vérifier mon kit Instagram Feed. »
- « Quelles vérifications Instagram Feed sont couvertes et quelles sont leurs limites ? »
- Après l'envoi du résumé : « Explique les anomalies de ce rapport et les corrections à demander. »

**Clé et coût** :
- La clé se saisit sur une page sécurisée, jamais dans la conversation.
- Elle est chiffrée et conservée **3 h au plus** (5 vérifications), puis effacée.
- Coût mesuré : moins d'un centime par annonce, facturé sur votre compte API OpenAI, distinct de l'abonnement ChatGPT. Détails dans [docs/security.md](docs/security.md).

## Kit d'exemple

`fixtures/demo/` contient trois annonces fictives (marque « Maison Ardoise », collection « Aurore ») :

| Annonce | Résultat attendu |
|---|---|
| FR | rien à signaler |
| UK | offre contradictoire : 30 % sur le visuel, 20 % en référence |
| DE | erreur de langue : visuel en français |

Fichiers fournis :
- `kit.csv` et ses 3 visuels ;
- `kit-invalide.csv` : import refusé ;
- `kit-excel-fr.csv` : séparateur « ; », refusé avec aide à la correction ;
- `modele.csv` : modèle vide.

Colonnes du CSV :
- obligatoires : `row_id`, `ad_name`, `locale`, `placement`, `media_filename`, `primary_text`, `cta`, `landing_url` ;
- facultatives : `reference_collection`, `reference_offer`, `reference_date` et `reference_date_label`.

## Prochaines étapes

**Prévues :**
1. **Placements supplémentaires** : Facebook Feed, puis Stories et Reels, chacun avec ses règles Meta sourcées et ses tests.
2. **Vidéo** sur un premier placement : métadonnées (durée, format, poids), extraction de quelques images, stockage privé et envoi direct.
3. **OAuth** (par exemple Descope MCP Auth, Marketplace Vercel) : une seule connexion par utilisateur, clé conservée dans un coffre, plus de ressaisie.

**Pistes à valider ensemble avant toute implémentation :**
4. Kits plus volumineux (au-delà de 10 annonces), avec traitement par lots.
5. Contrôles de texte supplémentaires : langue du texte principal par rapport à la locale, longueur des textes, libellé du CTA.
6. Historique des vérifications, pour comparer un kit avant et après correction.
7. Veille des spécifications Meta : alerte quand une page source change, mise à jour versionnée des règles.
8. Évaluation élargie sur des cas réels anonymisés : textes fins, fonds chargés, offres ambiguës.
9. Second fournisseur d'IA, qualifié par la même évaluation.
10. Interface en anglais pour les équipes internationales.

## Développement

Stack :
- Next.js 16, TypeScript 6, Node 24, pnpm ;
- SDK MCP v2, `ext-apps`, `mcp-handler` ;
- Zod, csv-parse, sharp ;
- OpenAI (Responses), Upstash Redis ;
- Vitest.

```bash
pnpm install --frozen-lockfile
pnpm check            # types + lint + tests + build
pnpm scan:secrets     # aucun secret dans les fichiers versionnés
pnpm eval             # mini-évaluation API réelle (clé dans .env.eval.local, chmod 600)
```

Configuration :
- les variables sont listées dans `.env.example` ;
- `.env*` et `.local-spec/` ne sont jamais versionnés ;
- l'exécution de la CI (`.github/workflows/ci.yml`) est désactivée sur ce dépôt privé, et les mêmes contrôles se lancent en local.

Documentation :
- [architecture](docs/architecture.md) ;
- [sécurité et clé OpenAI](docs/security.md) ;
- [règles Meta sourcées](docs/rules.md) ;
- [validation, preuves et coûts](docs/validation.md) ;
- [fiche de présentation](docs/listing.md).
