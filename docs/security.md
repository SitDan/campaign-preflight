# Sécurité, données et réserves

Ce POC est une démonstration contrôlée sur **données fictives**. Il ne s'agit pas d'une architecture de production multi-utilisateur. L'isolation repose sur la possession d'un secret aléatoire, pas sur une identité vérifiée, un compte utilisateur ou un OAuth.

## Pourquoi ce choix : clé de l'utilisateur en session éphémère

| | Clé fournie par le service | **Clé de l'utilisateur, session éphémère (retenu)** | OAuth + clé stockée durablement |
|---|---|---|---|
| Qui paie | l'opérateur, pour tous les utilisateurs | chaque utilisateur, sur son compte API | chaque utilisateur |
| Risque si l'URL circule | dépense et abus sur la clé de l'opérateur | nul pour l'opérateur ; chacun ne dépense que sa clé | faible |
| Secret détenu par le service | une clé maître très exposée | une clé chiffrée, 3 h au plus, supprimable | des clés durables : coffre, rotation, suppression de compte |
| Comptes / identité | indispensables (quotas, facturation) | aucun : la possession du code puis du bearer suffit | fournisseur d'identité, comptes, révocation |
| Effort | environ 1 à 1,5 jour (OAuth, quotas, facturation) | réalisé dans le POC | environ 2 jours + revue de sécurité |
| Friction | aucune clé à saisir | une saisie de clé par session (3 h, 5 validations de 10 annonces) | une seule connexion |

Ce compromis convient à une **démonstration limitée dans le temps, sur données fictives** :
- aucun coût ni secret longue durée ne pèse sur l'opérateur ;
- l'utilisateur garde le contrôle de sa dépense et peut révoquer sa clé chez OpenAI ;
- l'exposition est bornée dans le temps.

Prix payé : une ressaisie par session. Le brief prévoyait 60 minutes et 3 validations. Le 2026-10-06, l'utilisateur a choisi **3 heures et 10 validations** pour réduire cette friction, ce qui allonge d'autant la durée de détention de la clé chiffrée. Pour un pilote réel, la suite logique est OAuth avec un coffre de secrets, ou le financement des appels par le service avec des quotas par utilisateur. Ce choix relève du financement et de l'authentification, pas seulement de la technique.

## Clé OpenAI de l'utilisateur (BYOK)

- **Saisie** : uniquement sur `/setup`, notre page externe. La clé ne passe jamais par le chat, le composant, MCP, une URL ou un log.
- **Page `/setup`** :
  - HTML statique servi par Next.js, sans script de framework, analytics ni ressource tierce ;
  - CSP `default-src 'none'` avec empreintes SHA-256 du script et du style, `connect-src 'self'`, `form-action 'none'`, `frame-ancestors 'none'` ;
  - `Referrer-Policy: no-referrer`, `no-store` ;
  - champ `password` en `autocomplete="off"`, champs effacés juste après l'envoi.
- **Dépôt** : `POST /api/setup` exige `Origin` exactement égal à `APP_ORIGIN`, `application/json` et un corps de 8 Kio au plus. Un code inconnu, expiré, déjà utilisé ou mal formé reçoit la même réponse générique.
- **Code d'association** : usage unique, valable 10 minutes. Il ne permet ni de lire la clé, ni d'obtenir le bearer, ni de consulter un rapport. Deux dépôts concurrents : un seul réussit, par consommation atomique en Lua. Une session `ready` n'accepte aucun remplacement.
- **Aucun appel OpenAI** n'a lieu au dépôt. La première analyse réelle vérifie l'accès au modèle.

## Chiffrement

- AES-256-GCM, clé maître serveur de 32 octets (`BYOK_ENCRYPTION_KEY_B64`, secret Vercel *sensitive*, distinct de Redis, jamais `NEXT_PUBLIC_*`), IV aléatoire de 12 octets, tag de 16 octets.
- Enveloppe versionnée : `version`, `keyId`, `iv`, `ciphertext`, `authTag`.
- L'AAD canonique lie `APP_ENV`, `sessionId`, `expiresAt` et `keyId`. Elle est reconstruite depuis le contexte serveur.
- Une enveloppe altérée, déplacée vers une autre session ou une autre échéance, ou associée à une autre clé maître est **refusée**. Ces cas sont couverts par les tests.
- La clé est déchiffrée en mémoire pour **un** appel, avec un client OpenAI créé pour cet appel. Il n'y a ni singleton partagé, ni cache SDK persistant.

Nous ne promettons ni un chiffrement de bout en bout, ni une clé « jamais en clair nulle part ». Le navigateur voit la clé pendant la saisie et le serveur l'a en mémoire pendant l'appel. JavaScript ne garantit pas l'effacement de la mémoire.

## Session et accès

- Le bearer (32 octets) est transmis une seule fois, en `no-store`. Il vit en mémoire dans une fermeture du client HTTP du composant. Il n'apparaît pas dans l'état de l'hôte, le contexte du modèle, une URL ou un stockage navigateur.
- Les routes privées n'acceptent qu'`Authorization: Bearer`. L'appartenance session → run → ligne est contrôlée à chaque accès. Les tests A/B couvrent le cas où les identifiants de l'autre session sont connus.
- CORS n'accepte que les origines exactes listées dans `WIDGET_ALLOWED_ORIGIN`, jamais `*`, `null` ni une origine reflétée. CORS n'est pas une autorisation.
- L'échéance absolue est de 3 heures après la création, sans prolongation (le brief prévoyait 60 minutes ; voir « Pourquoi ce choix »). `DELETE /api/session` retire la clé chiffrée, les résultats et l'index de code. Une écriture tardive ne recrée rien : le compare-and-set échoue sur une clé absente.

## Anti-abus

- 5 créations de session par heure et par IP fiable ; 20 soumissions `/setup` par heure et par IP. L'IP n'est jamais stockée en clair.
- Plafonds globaux : 100 sessions et 200 tentatives IA par jour UTC. Interrupteur `DEMO_ENABLED`.
- **IP fiable** : seul `x-real-ip` posé par la plateforme Vercel est retenu. Hors Vercel, aucun header n'est cru et seuls les plafonds globaux s'appliquent.
- Derrière une IP partagée (entreprise, NAT), des utilisateurs peuvent se bloquer mutuellement.

## Médias et données envoyées à OpenAI

- Les images sont traitées en mémoire pendant la requête. Elles ne sont écrites ni sur disque, ni dans Redis, ni dans Blob.
- Seule une copie réduite part chez OpenAI : orientée, sRGB, sans métadonnées, 2 048 px et 1 Mio au maximum. Elle est accompagnée de la locale, du texte principal (comme contexte) et des références de **sa** ligne.
- Paramètres d'appel : `store: false`, `max_output_tokens: 2048`, `reasoning.effort: low`, sortie JSON stricte. `store: false` ne garantit pas l'absence de toute rétention chez le fournisseur.
- Le texte de l'image et les champs du CSV sont des données non fiables. Le prompt l'indique, et l'évaluation contient un cas d'injection imprimée.

## Journalisation

Les logs suivent une liste autorisée : événement, code, statut, durée, origine du composant, usage numérique et modèle. Ils n'incluent jamais de corps HTTP, de headers, de secret, de CSV, de prompt ou d'erreur fournisseur brute. Aucune route n'expose l'environnement.

## Sous-traitants et rétention

| Sous-traitant | Données | Rétention |
|---|---|---|
| Vercel | requêtes, traitement en mémoire des images, logs filtrés | selon Vercel (logs d'exécution) |
| Upstash (Redis, via Vercel Marketplace) | document de session : clé chiffrée, manifest, résultats, compteurs | TTL d'au plus 3 h. **Sauvegardes du fournisseur non maîtrisées** : TTL et DELETE ne prouvent pas leur effacement immédiat. |
| OpenAI | copie d'analyse, champs utiles de la ligne | selon la politique API d'OpenAI. Une suppression chez nous ne révoque pas la clé chez OpenAI. |

Supprimer notre copie ne vaut pas révocation : l'utilisateur doit révoquer sa clé dans son compte OpenAI s'il le souhaite. Un appel en cours peut se terminer et être facturé.

## Rotation de la clé maître

1. Passer `DEMO_ENABLED=false`.
2. Purger l'état actif (préfixe `cp:`).
3. Remplacer `BYOK_ENCRYPTION_KEY_B64` et `BYOK_ENCRYPTION_KEY_ID`, puis redéployer.

Il n'y a pas de migration des anciennes enveloppes.

## Réserve : distribution et politique des plugins

Les règles publiques OpenAI pour les plugins de l'annuaire excluent la collecte de secrets. La section « Restricted data » cite « Access credentials and authentication secrets (such as API keys…) » (https://developers.openai.com/plugins/plugin-guidelines).

Le formulaire externe **ne démontre pas** une exception ni une conformité acquise. Ce POC n'est **pas soumis** à l'annuaire. Une démo technique réussie ne prouve ni l'acceptation par l'annuaire, ni la compatibilité avec toutes les politiques de workspace.

Avant toute publication ou exploitation réelle, il faudra clarifier le financement et l'authentification. Un OAuth vers notre service ne donnerait pas automatiquement accès au budget OpenAI de l'utilisateur.
