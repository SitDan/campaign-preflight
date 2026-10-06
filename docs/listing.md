# Fiche de présentation (annuaire des apps ChatGPT)

> Prête pour examen, **non soumise**. La réserve sur la collecte de clés API est décrite dans [security.md](security.md).

**Nom** : Campaign Preflight

**Description en une ligne** : Vérifiez vos annonces Instagram Feed avant leur publication sur Meta : formats, règles Meta et textes des visuels.

## Ce que l'app fait

- Elle vérifie un kit d'annonces Instagram Feed (un CSV et des images JPEG/PNG, jusqu'à 10 annonces, en FR, EN et DE).
- Elle compare chaque visuel aux règles Meta officielles (format, poids, dimensions, ratio), sourcées et datées.
- Elle lit le texte des visuels avec l'IA et signale, comme « à vérifier », les différences avec les informations du CSV : langue, offre, collection, date.
- Elle affiche un résultat par annonce (« À corriger », « À vérifier », « Rien à signaler ») et la liste de ce qui n'a pas pu être vérifié.
- Elle fait rédiger par ChatGPT l'e-mail de demande de corrections, et exporte le rapport en CSV.

## Ce que l'app ne fait pas

- Elle ne publie rien et ne se connecte à aucun compte Meta.
- Elle ne corrige, ne recadre et ne traduit aucun visuel.
- Elle ne garantit ni l'approbation par Meta, ni la conformité juridique ou publicitaire.
- Elle ne juge ni le style ni la qualité créative.
- Elle ne traite ni les vidéos, ni les carrousels, ni les placements autres qu'Instagram Feed.
- Elle ne conserve ni les images, ni l'historique au-delà de la session (3 h au plus).

## Outils exposés

- `open_campaign_preflight` : ouvre l'interface, sans dépense ni création de session.
- `get_meta_requirements` : renvoie les règles Meta vérifiées (avec source et date) et les limites du POC.

Les deux outils sont en lecture seule.

## Prérequis et données

- Il faut un ChatGPT qui autorise les serveurs MCP personnalisés.
- Les analyses passent par la clé OpenAI de l'utilisateur, saisie sur une page sécurisée, chiffrée et effacée au bout de 3 h. Pour tester, il existe une clé de démonstration plafonnée.
- Les images sont traitées en mémoire. Une copie réduite et les informations de sa ligne sont envoyées à OpenAI.
- Données publiques ou fictives uniquement.
