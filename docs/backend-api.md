# API backend et intégration Monad

L’API est implémentée dans `server/api/`. Le navigateur joue avec le moteur partagé
`runner-5-oncoming-60hz`, à 60 ticks/s. Le serveur rejoue exactement ce moteur avant
que le relayer puisse transmettre un résultat à `MonadSurf` sur Monad testnet 10143.
Aucune vidéo n’est envoyée. Le rejeu prouve la cohérence des commandes, pas leur
origine corporelle. Le fantôme reste retiré du jeu, conformément à la demande de Noé.

## Configuration

Copier [`.env.example`](../.env.example) vers `.env`, puis renseigner :

| Variable serveur | Usage |
| --- | --- |
| `NUXT_DATABASE_URL` | PostgreSQL durable, partagé entre les instances ; utiliser TLS et le pool fourni par l’hébergeur |
| `NUXT_SITE_ORIGIN` | Origine exacte du site, sans chemin ; HTTPS en ligne |
| `NUXT_MONAD_RPC_URL` | RPC Monad testnet, vérifié par son chain ID |
| `NUXT_MONAD_CONTRACT_ADDRESS` | Adresse du contrat déployé contenant `getLeaderboard` |
| `NUXT_RELAYER_PRIVATE_KEY` | Clé du relayer désigné dans le constructeur, approvisionné en MON de test |
| `NUXT_RELAY_SECRET` | Secret aléatoire d’au moins 32 caractères pour le worker |

Ces variables appartiennent au `runtimeConfig` privé. Elles ne doivent pas entrer
dans `runtimeConfig.public`, le dépôt, le bundle navigateur ou les logs.
La clé relayer doit être dédiée à cette file et ne pas être utilisée par un autre
script ou une autre base. Le contrat possède un relayer immuable : un changement
de clé ou de contrat exige de traiter les tâches existantes avant toute migration.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

`db:migrate` installe les tables et index dans une transaction. Les identifiants,
sessions, inputs et transactions signées sont persistés dans PostgreSQL, jamais
dans le système de fichiers éphémère de Vercel. Le schéma se trouve dans
[server/database/schema.sql](../server/database/schema.sql).

Pour que les confirmations continuent après fermeture du navigateur, exécuter
`pnpm relay` dans un worker supervisé, avec `NUXT_SITE_ORIGIN` et
`NUXT_RELAY_SECRET`. Il appelle `POST /api/relay` toutes les cinq secondes ; un
planificateur externe peut appeler la même route avec `Authorization: Bearer …`.
Le navigateur fait aussi progresser la file tant que l’écran de résultat est ouvert.
Aucune promesse serveur détachée n’est utilisée. Sans navigateur ni worker actif,
les tâches restent conservées et attendent le prochain appel.

Le déploiement du contrat, la base hébergée, son application de schéma, les variables
Vercel et l’exécution du worker sont des étapes d’exploitation à configurer ; la
fusion de code ne déploie pas ces services. La pipeline de `main` est conservée.

## Routes et échanges

Toutes les réponses portent `Cache-Control: no-store`. Les écritures du navigateur
exigent `application/json` et l’`Origin` exact. Les erreurs contrôlées exposent
`data.message`, sans détail des secrets ni du stockage. Les types partagés sont
[shared/api.ts](../shared/api.ts) et [shared/types.ts](../shared/types.ts).

| Route | Corps et résultat |
| --- | --- |
| `POST /api/session` | `{ pseudo }` → `{ playerId, pseudo }` |
| `DELETE /api/session` | `{}` → révocation de la session et suppression du cookie |
| `POST /api/runs` | `{ requestKey }` → `{ runId, playerId, pseudo, seed, simulationVersion, expiresAt }` |
| `POST /api/run` | `RunResult` complet → état de soumission |
| `GET /api/runs/:runId` | État de la partie appartenant à la session |
| `POST /api/runs/:runId/relay` | `{}` → progression de la file et état de la partie du joueur |
| `GET /api/leaderboard` | `{ blockNumber, entries: [{ playerId, pseudo, score }] }` |
| `POST /api/relay` | Route du worker, authentifiée par secret, sans cookie joueur |

Une réponse réussie utilise HTTP 200. L’état de soumission contient `runId`,
`status`, `transactionHash` et `error`. Les états sont `ready`, `queued`,
`submitted`, `confirmed` et `failed`. Le hash est connu dès la signature persistée ;
sa présence seule ne prouve ni diffusion réussie ni confirmation.

## Sessions et création des parties

Le serveur génère un `playerId` et un jeton de session aléatoires de 32 octets.
Seule l’empreinte SHA-256 du jeton est stockée. Le cookie est `HttpOnly`,
`SameSite=Strict`, `Path=/`, valable 30 jours. En HTTPS, il s’appelle
`__Host-monad-session` et porte `Secure`. Le développement HTTP utilise
`monad-session`. Aucun jeton ne revient dans le JSON ou `localStorage`.

Le pseudo est normalisé NFC, limité à 20 unités UTF-16 et débarrassé des espaces
périphériques ; caractères de contrôle et de format interdits. Changer son pseudo
conserve l’identité, mais « Changer de joueur » révoque la session. Deux sessions
avec le même nom restent distinctes. Un cookie perdu ne se récupère pas avec le pseudo.

La création d’une partie persiste propriétaire, pseudo initial, graine aléatoire,
version, contrat cible et échéance de 24 heures. `requestKey` est un UUID client ;
la contrainte `(player_id, request_key)` renvoie la même partie sur répétition,
tant que celle-ci attend son résultat et que le pseudo n’a pas changé.
Le serveur choisit la graine et la version, sans dépendance aux blocs Monad.

## Rejeu et idempotence

Le serveur vérifie le propriétaire, la graine, le pseudo initial et la version.
Score, pièces et ticks doivent être des entiers JavaScript sûrs non négatifs ; il
faut une commande valide par tick. La simulation doit se terminer exactement au
dernier tick, avec les mêmes points et pièces que le résultat annoncé.

Limites d’enregistrement : corps de 4 Mio, 108 000 ticks, soit 30 minutes simulées.
Le jeu local peut continuer au-delà ; son résultat ne pourra pas être crédité.
La durée simulée ne peut pas dépasser le temps depuis la création, avec une
marge de deux secondes. Les pauses sont donc autorisées. Une partie non soumise
expire après 24 heures ; une soumission déjà acceptée peut être retentée après
cette échéance avec la même session et les mêmes données.

Après rejeu, le résultat normalisé, son empreinte et l’état `queued` sont enregistrés
atomiquement. Des demandes concurrentes identiques retrouvent le même résultat ;
un autre résultat valide pour le même identifiant est refusé avec 409. Les champs
supplémentaires sans effet sont ignorés par la normalisation. Une tentative qui
échoue au rejeu n’est pas créditée et ne réserve pas de transaction.

Limites par minute : 20 créations/mises à jour de session par IP, 12 créations de
partie et 6 soumissions par joueur, 30 appels de relayer par joueur et 30 lectures
de classement par IP. Elles sont partagées dans PostgreSQL. Sur Vercel, l’IP
provient de son [en-tête `x-vercel-forwarded-for`](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for) ; en local, de la connexion directe. Les erreurs utilisent
400, 401, 403, 404, 409, 410, 413, 415, 422, 429 ou 503 selon le cas.

## File relayer et confirmation

Un verrou transactionnel PostgreSQL protège un émetteur logique. Une seule
transaction reste en vol ; les suivantes attendent sa résolution. Le nonce est
alloué lors de la préparation et conservé dans la transaction signée. Les octets
signés et le hash sont enregistrés **avant** toute diffusion. Une reprise après
crash ou erreur réseau diffuse ces mêmes octets, jamais un nouveau crédit.

Le reçu doit réussir, concerner le contrat et le signataire attendus, et contenir
`RunSubmitted` avec les bons run, joueur, score et pièces. Le bloc du reçu est
revérifié et un bloc supplémentaire doit exister avant `confirmed`. Ce seuil de
deux confirmations ne constitue pas une garantie de finalité irréversible.
Une transaction rejetée passe à `failed`, une indisponibilité RPC garde la tâche.
Le contrat apporte en plus l’unicité globale des `runId`.

Le remplacement automatique d’une transaction bloquée par des frais trop faibles
n’est pas implémenté. La file reste alors en attente : intervenir sur la même
transaction/nonce et conserver les preuves avant toute reprise. Ne pas contourner
la file avec une autre utilisation de la clé.

## Top 25 et affichage en jeu

La route lit `getLeaderboard()` à un bloc déterminé, puis résout les pseudos dans
une lecture groupée PostgreSQL. Les scores viennent du contrat, sous forme de
chaînes décimales conservant toute la précision `uint64`. Un nom inconnu donne
`null` et le front affiche un identifiant abrégé.

Au début de chaque partie, le front conserve un instantané. Il exclut son propre
joueur, choisit le score strictement supérieur le plus proche et calcule l’écart
avec `BigInt`. Quand une cible est atteinte, la suivante prend sa place. Aucun
appel réseau n’est effectué par tick. Le classement complet figure sous le jeu.
Les erreurs de chargement, classement vide et absence de cible sont distingués.

À la fin, le résultat est envoyé et le front affiche validation, attente,
transaction envoyée ou confirmation, avec lien explorateur et reprise sur erreur.
Si le service manque au lancement, la course reste locale et l’interface l’annonce ;
aucun faux classement ni faux statut de confirmation n’est créé.

## Vérification

```sh
pnpm test
pnpm typecheck
pnpm build
# Compiler d’abord le contrat avec Forge, puis :
pnpm test:integration
```

Le test d’intégration lance un PostgreSQL éphémère dans Docker, Anvil en chain ID
10143 et le serveur Nuxt construit. Ses comptes sont aléatoires, alimentés uniquement
sur cette EVM locale. Il couvre cookies, contrôle d’origine, propriété des parties,
rejeu, falsification, concurrence, redémarrage du serveur, nonces, crédit unique,
classement et révocation. Il nettoie ses processus et son conteneur à la fin.
Ces tests ne remplacent pas un essai sur le contrat réellement déployé sur Monad.
