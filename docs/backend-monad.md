# MonadSurf — persistance onchain

Le contrat [MonadSurf.sol](../contracts/src/MonadSurf.sol) conserve toutes les
données métier. Le [backend Nuxt](backend-api.md) assure l’authentification par
cookie, le rejeu des commandes et le paiement des transactions, sans PostgreSQL.

## Données du contrat

| Lecture | Données |
| --- | --- |
| `getPlayer(playerId)` | Meilleur score `uint64`, pièces cumulées `uint128`, parties `uint64`, expiration de session, pseudo |
| `getRun(runId)` | Joueur, graine, hash de version, empreinte du replay, date de création, bloc de soumission, score, pièces, ticks, pseudo initial |
| `getLeaderboard()` | Jusqu’à 25 tuples `{ playerId, score, pseudo }` |
| `processedRuns(runId)` | Présence d’un résultat enregistré |
| `writeAvailable()` | Disponibilité du quota partagé de 60 écritures/minute |
| `relayer()` | Adresse immuable autorisée à écrire |

Le secret du cookie et la clé du relayer restent privés. Le contrat contient
l’identifiant dérivé du cookie, jamais le cookie lui-même. Les pseudos, paramètres
et résultats sont publics.

## Écritures

Toutes les mutations sont réservées au relayer et consomment le quota partagé.
Le déployeur n’a aucun privilège supplémentaire.

- `savePlayer(playerId, pseudo)` crée un profil avec une session de 30 jours,
  ou actualise son pseudo si la session est encore active.
- `revokeSession(playerId)` met l’expiration à zéro, sans effacer les statistiques.
- `startRun(runId, playerId, seed, simulationVersion)` inscrit une partie unique
  avec le pseudo courant et l’horodatage du bloc.
- `submitRun(runId, score, coins, tickCount, inputs)` inscrit le résultat validé,
  conserve l’empreinte du replay et émet ses commandes dans `RunSubmitted`.

Une soumission exige une partie connue, non créditée, âgée de moins de 24 heures,
une taille de replay cohérente et au plus 108 000 ticks. La durée simulée ne peut
pas dépasser le temps écoulé avec la marge de deux secondes. Les agrégats et le
classement sont mis à jour atomiquement. Les erreurs annulent toute l’opération.

Le contrat fait confiance au relayer pour la validité du score : le rejeu du
moteur reste côté serveur. La vidéo reste locale. Aucun wallet joueur, proxy,
NFT, token, boutique ou fantôme n’est ajouté.

## Replays

Chaque tick est représenté par un octet de 0 à 8. Le calcul et l’inverse sont
décrits dans [l’interface](interface.md#3-commandes-et-encodage).
L’événement `RunSubmitted(runId, playerId, score, coins, tickCount, inputs)`
conserve les commandes sur la chaîne, sans recopier tous les octets dans le
stockage Solidity. `getRun` expose leur empreinte `keccak256`, la graine, la
version du moteur et le bloc contenant l’événement.

## Top 25 historique

Un seul record strictement positif par joueur. Tri par score décroissant puis
identifiant croissant en cas d’égalité. Améliorer son record reclasse le joueur
sans doublon ; un 26e joueur suffisamment bien classé évince le dernier. Les
statistiques d’un joueur évincé sont conservées. Un score inférieur ou égal ne
modifie pas le classement, tout en créditant les pièces et la partie.

Le classement ne parcourt jamais l’ensemble des joueurs : au plus 25 positions
sont déplacées. Les noms sont lus dans les profils lors de `getLeaderboard`,
donc un changement de pseudo n’exige pas de réécrire le tableau.

Les scores `uint64` restent exacts via `bigint` puis chaînes décimales JSON.
La cible en jeu est le score strictement supérieur le plus proche, en excluant
le joueur courant. C’est l’écart local qui diminue, pas le record onchain.

## Déploiement et tests

Réseau : Monad testnet `10143`. Compilation : solc `0.8.24`, optimiseur 200,
EVM Cancun. Voir [les commandes Foundry et le déploiement](../contracts/README.md)
et [le manifeste actif](../contracts/deployments/monad-testnet.json).

Le relayer est immuable. Un changement de clé ou de schéma nécessite un nouveau
contrat ; le top 25 est propre à chaque instance. Le déploiement initial reste
archivé pour distinguer les adresses et leurs données.

Les tests Solidity couvrent profils, expiration et révocation, graines, replays,
quotas, autorisations, doubles crédits, agrégats et top 25. Les tests API démarrent
deux instances contre une seule EVM pour vérifier les accès et les envois
concurrents. Aucune base externe ni aucun worker de reprise n’est requis.
