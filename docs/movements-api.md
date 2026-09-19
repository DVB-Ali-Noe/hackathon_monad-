# Mouvements onchain — raccordement du front

Sur la branche `chain`, `MonadMoves` et les routes ci-dessous sont implémentés.
Le front n'est pas modifié et n'appelle pas encore cette API. Le nouveau contrat
n'est pas déployé sur le testnet. Le contrat des scores déjà déployé reste valable.

La simulation, la caméra et le rendu restent locaux à 60 Hz. Une transaction
enregistre un **changement de commande appliqué à un tick**, pas chaque image de
la webcam. Le retour au centre et la fin d'un saut/accroupissement sont également
des changements. Une commande contenant simultanément couloir et action produit
une seule transaction.

## Isolation du jeu et des scores

`MonadMoves` référence l'adresse existante de `MonadSurf`. Il possède un relayer
distinct, imposé par son constructeur : ses frais, ses nonces et son quota
n'utilisent pas ceux des sessions et scores. Une panne de ce relayer n'empêche pas
la soumission habituelle du score. Les deux services partagent toutefois le RPC
et la blockchain ; cela ne garantit pas l'absence de congestion réseau.

Le journal est une trace des commandes reçues, indépendante de la validation du
résultat. Les mouvements live ne sont pas rejoués à chaque requête. Le score reste
recalculé par `POST /api/run`, dont le replay complet fait référence. Un journal
peut rester incomplet ou être incompatible avec ce replay : sa présence ne valide
ni un score, ni l'authenticité des gestes. Les mouvements reçus après soumission
du résultat doivent correspondre à un changement du replay enregistré.

## Configuration serveur

Les quatre variables habituelles restent nécessaires. Deux variables privées
optionnelles activent uniquement le journal :

| Variable | Contenu |
| --- | --- |
| `NUXT_MONAD_MOVES_ADDRESS` | Adresse d'un `MonadMoves` déployé pour le `MonadSurf` configuré |
| `NUXT_MOVES_RELAYER_PRIVATE_KEY` | Clé du relayer de mouvements, différent du relayer des scores et alimenté en MON testnet |

Sans cette configuration, les routes de mouvements répondent 503 ; le jeu et
l'enregistrement habituel des scores continuent à fonctionner. Aucune clé ne
doit être placée dans `runtimeConfig.public`, Git ou le code du navigateur.

Pour préparer le déploiement : compiler `contracts/src/MonadMoves.sol` avec
solc 0.8.24 et les paramètres Foundry du dépôt. Le constructeur attend
`(adresseDuMonadSurfExistant, adressePubliqueDuRelayerMouvements)`. Son bytecode et
son ABI sont dans `contracts/out/MonadMoves.sol/MonadMoves.json`. Déployer ce
contrat supplémentaire, puis configurer les deux variables ; ne pas remplacer
`NUXT_MONAD_CONTRACT_ADDRESS` ni le manifeste du contrat des scores.

## Écriture

`POST /api/runs/:runId/movements`

Même cookie HttpOnly que les autres routes, `Origin` exact et
`Content-Type: application/json`. Corps limité à 512 octets :

```json
{ "sequence": 0, "tick": 27, "lane": -1, "action": "none" }
```

- `sequence` commence à zéro et augmente de un par changement.
- `tick` est l'indice, à partir de zéro, dans `RunResult.inputs` ; il augmente
  strictement. Une pause caméra ne produit aucun tick ni mouvement.
- `lane` vaut `-1`, `0` ou `1` ; `action` vaut `none`, `jump` ou `crouch`.
- L'état initial implicite est `{ lane: 0, action: 'none' }`. Le premier tick
  différent de cet état produit la séquence zéro, même si ce tick est zéro.
- Comparer les commandes réellement transmises au moteur, après filtrage caméra.
  Un tick inchangé ne produit aucune transaction.

La réponse 200 intervient après inscription onchain et contient :

```json
{
  "runId": "0x…",
  "sequence": 0,
  "tick": 27,
  "lane": -1,
  "action": "none",
  "historyHash": "0x…",
  "transactionHash": "0x…",
  "blockNumber": "123",
  "status": "included"
}
```

`included` signifie présent dans le bloc canonique consulté ; `confirmed` ajoute
un bloc supplémentaire. Une nouvelle tentative identique renvoie la transaction
d'origine. Une même séquence avec un autre contenu reçoit 409. Aucun accusé de
réception en mémoire n'est présenté comme une écriture persistante.

## Lecture et reprise

`GET /api/runs/:runId/movements` renvoie le curseur onchain :

```json
{
  "runId": "0x…",
  "nextSequence": 1,
  "lastTick": 27,
  "lastInput": { "lane": -1, "action": "none" },
  "historyHash": "0x…"
}
```

Avant la première écriture : `nextSequence=0`, `lastTick=null`, état neutre et
hash nul. `GET /api/runs/:runId/movements/:sequence` retrouve le mouvement, son
statut et sa transaction. Les lectures exigent la session propriétaire.

| Erreur | Action du client |
| --- | --- |
| 400 / 413 | Corriger le format ou la taille ; ne pas répéter le même corps |
| 401 / 403 / 404 | Arrêter les envois pour cette session/partie ; laisser le jeu local continuer |
| 409 | Relire le curseur et la séquence concernée, réconcilier avec la file locale |
| 410 | Partie expirée, ne plus envoyer son journal |
| 422 | Commande inchangée, tick impossible ou incompatible avec le replay final ; corriger l'intégration |
| 429 | Attendre avec temporisation avant de renvoyer la même commande |
| 503 / coupure / timeout | L'écriture peut déjà être passée : relire ou renvoyer exactement la même commande |

## Consignes pour l'agent front

1. Après `POST /api/runs`, créer une file de changements propre au `runId`.
2. Dans la capture des inputs, ajouter seulement les changements à cette file.
   **Ne jamais attendre un appel HTTP ou une confirmation dans la boucle du jeu.**
3. Un consommateur asynchrone séparé envoie une commande à la fois, dans l'ordre.
   Réutiliser le même corps lors d'une reprise, sans renuméroter les commandes.
4. Utiliser un timeout HTTP de 55 secondes et un délai progressif sur erreur.
   Le retard éventuel du journal ne suspend ni le rendu ni la simulation.
5. Soumettre le résultat par le chemin existant, indépendamment de cette file.
   Le journal peut finir de se vider après la partie, pendant les 24 heures
   suivant sa création, tant que la session reste active.
6. Séparer les files des parties successives. Une réponse d'une ancienne partie
   ne doit jamais modifier la nouvelle. Ne pas marquer une commande enregistrée
   avant l'accusé onchain ; conserver les commandes non acquittées pour reprise.

L'API n'a ni PostgreSQL ni worker permanent. Elle attend sa transaction dans la
requête HTTP ; une fonction serverless n'exécute pas de promesse détachée après
sa réponse. Avant diffusion, perdre la file du navigateur peut perdre des
mouvements. Après diffusion, une réponse HTTP perdue se récupère depuis le contrat.

## Bornes et vérification

Ticks et séquences : `0..107999`. La durée simulée ne dépasse pas le temps réel
depuis la création, avec deux secondes de marge. Les ticks après la fin d'une
partie déjà soumise sont refusés.

Quotas onchain : 300 mouvements/minute/joueur, partagés entre ses parties, et
600/minute au total, par fenêtres de minutes. Les doublons identiques ne consomment
pas ce quota. Limites HTTP locales par instance : 600 écritures et 120 lectures
par minute/joueur. Plafond de frais par transaction : 0,1 MON. Ces plafonds ne
garantissent pas un débit ; le wallet de mouvements conserve une transaction en
vol à la fois. Un afflux peut créer du retard dans la file du navigateur.

Le contrat stocke chaque commande et son bloc, plus un hash cumulatif :
`keccak256(abi.encodePacked(hashPrécédent, uint32(sequence), uint32(tick), uint8(input)))`,
avec `input=(lane+1)*3+action` et `none=0`, `jump=1`, `crouch=2`.
`MovementRecorded` fournit la transaction correspondante.

Les tests couvrent autorisations, quotas distincts, ordre, doublons, concurrence
entre deux serveurs, reprise après redémarrage et conservation du circuit des
scores. Après raccordement, mesurer la latence et le débit sur testnet, puis le
rendu avec un RPC lent ou indisponible avant de promettre une fluidité inchangée.
