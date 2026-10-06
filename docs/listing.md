# Fiche de présentation — brouillon pour examen (non soumise)

> Brouillon interne. **Aucune soumission à l'annuaire n'est faite ni demandée.** Voir la réserve BYOK dans `docs/security.md`.

## Nom

Campaign Preflight

## Description courte

Repérez les erreurs dans vos annonces Instagram Feed avant leur publication sur Meta : côté créatif avant l'envoi au media buyer, côté media buyer avant l'implémentation dans Meta.

## Description

Campaign Preflight aide une équipe marketing à relire un petit kit d'annonces **Instagram Feed (images)** avant de le transmettre à son agence média. Le kit comprend un CSV imposé et jusqu'à 3 images JPEG/PNG. Le rapport présente :

- les **mesures techniques certaines** : format, poids, dimensions après orientation, ratio, comparés aux exigences et recommandations Meta sourcées et datées, et séparés des limites du POC ;
- les **anomalies du kit** : champs manquants, locale ou placement hors périmètre, image absente, URL non HTTPS ;
- les **alertes IA à confirmer** : contradictions explicites entre le texte visible de l'image et les références fournies (langue, offre, collection nommée, date contextualisée) ;
- la liste des **contrôles non effectués**.

Le produit ne juge pas le style, ne certifie pas la conformité juridique et ne promet pas l'approbation de Meta.

## Fonctions

- `open_campaign_preflight` : ouvre le composant. Ne crée aucune session et n'engage aucune dépense.
- `get_meta_requirements` : renvoie les règles publiques vérifiées (source et date) et, séparément, les limites du POC.
- Dans le composant : configuration de la clé, sélection du kit ou kit fictif, analyse, rapport, export CSV, « Expliquer le rapport dans ChatGPT », suppression.

## Prérequis

- Un compte ChatGPT, sur le web, autorisé à ajouter un serveur MCP personnalisé. Les politiques du workspace s'appliquent.
- Une **clé API OpenAI personnelle**, avec du crédit API et l'accès au modèle configuré (`gpt-6-luna`). La facturation API est distincte de l'abonnement ChatGPT.

## Permissions et données

- Aucune connexion à un compte Meta, aucune publication, aucune réécriture des créations.
- La clé est saisie sur une page externe du service, chiffrée et conservée 3 heures au plus.
- Les images sont traitées en mémoire. Une copie réduite et les références de sa ligne sont envoyées à OpenAI avec la clé de l'utilisateur.
- Seuls des résultats textuels sont conservés, au plus 3 heures, avec suppression à la demande.

## Limites

- Instagram Feed, images statiques JPEG/PNG, 10 annonces par kit, locales fr-FR, en-GB et de-DE.
- Les alertes IA sont des observations à confirmer, pas une lecture OCR certaine.
- Recharger le composant impose une nouvelle session.
- Le téléchargement de fichier dépend de l'hôte. Sans lui, le CSV intégral s'affiche en texte sélectionnable.
- Données publiques ou fictives uniquement. Ne pas utiliser de campagnes clients.
