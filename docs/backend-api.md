# Proposition d'API backend — prochain lot

**Statut : contrat d'échange proposé, aucune route implémentée.** Le moteur
`shared/game/` est requis avant toute acceptation de résultat. Les types suivent
[interface.md](interface.md) ; ce document ne modifie ni ses types ni les fichiers
possédés par le frontend. Les noms de routes et règles ci-dessous sont à aligner
avec le front à l'intégration.

## 1. Identité et session

`POST /api/session`, corps JSON `{ "pseudo": "Noé" }` :

- sans session valide, crée un `playerId` interne et une session, puis répond `201` ;
- avec une session valide, conserve son `playerId`, met à jour son pseudo
  d'affichage et répond `200` ; une partie déjà créée conserve son ancien pseudo ;
- deux sessions indépendantes portant le même pseudo restent deux joueurs distincts.

Réponse : `{ "playerId": "0x…", "pseudo": "Noé", "expiresAt": "…" }`.
`playerId` est un identifiant aléatoire non nul de 32 octets, encodé en hexadécimal
minuscule (`0x` et 64 caractères). Il est créé par le serveur avec un générateur
cryptographique et une contrainte d'unicité ; ce n'est ni un hash du pseudo ni
un secret d'authentification. `expiresAt` est une date UTC ISO 8601.

Cookie proposé en production :

```http
Set-Cookie: __Host-monad-session=<jeton-opaque>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<durée-session>
Cache-Control: no-store
```

Jeton aléatoire cryptographique de 32 octets minimum ; conserver son empreinte côté
serveur avec `playerId`, expiration et révocation. Aucun `Domain`, aucune identité
choisie dans le cookie par le navigateur. Le jeton ne revient jamais dans le JSON,
les URL ou les journaux. Ne pas utiliser `localStorage` pour l'authentification.
Pour le développement HTTP, prévoir un nom de cookie local sans préfixe `__Host-`,
uniquement dans l'environnement local ; la production garde `Secure`.

L'API est de même origine que l'application. Les écritures exigent JSON et un
`Origin` exact autorisé côté serveur, sans CORS permissif ; le cookie `SameSite`
ne remplace pas ce contrôle. Limiter le débit de création des sessions et parties.
Proposition pour le pseudo : normalisation Unicode NFC, espaces périphériques
retirés, 1 à 32 points de code, caractères de contrôle interdits ; l'affichage
utilise du texte échappé. Ces règles d'affichage ne créent jamais de droit d'accès.

La durée de session, la récupération d'identité après perte du cookie et le bouton
« nouveau joueur » sur une borne partagée restent à décider. Sans récupération,
une session perdue ne peut pas être restaurée en ressaisissant le même pseudo.
Une réponse de création de session perdue avant réception du cookie peut laisser
une session orpheline, à expirer ; elle ne crédite aucune partie.

## 2. Création d'une partie

`POST /api/runs`, session requise, corps JSON `{}`.
Un `Idempotency-Key` opaque est généré une fois par intention de lancer une partie
et réutilisé lors de ses nouvelles tentatives réseau. Le serveur l'enregistre
avec le joueur et le corps normalisé : même clé et même corps rendent la même
partie, même clé et corps différent donnent `409 IDEMPOTENCY_CONFLICT`.
Une contrainte unique `(playerId, idempotencyKey)` assure cette propriété en concurrence.

Le serveur crée un `runId` aléatoire non nul de 32 octets (même encodage que
`playerId`), unique globalement pour le contrat cible. Il persiste le propriétaire,
le pseudo au lancement, la graine tirée côté serveur, la version autorisée du moteur
et l'expiration **avant** de répondre `201` (`200` sur répétition).

```ts
type CreatedRun = {
  runId: string
  pseudo: string
  seed: string
  simulationVersion: string
  expiresAt: string
}
```

`seed` est une chaîne opaque à conserver à l'identique. Son encodage et son
interprétation seront fixés avec le générateur partagé ; ne pas imposer un parseur
différent côté serveur. `simulationVersion` vient d'une liste de versions réellement
disponibles côté serveur, avec fréquence et règles de simulation associées.
Le client ne choisit ni la graine ni une version arbitraire. Aucun hash de bloc
Monad n'intervient dans le parcours.

Pour le futur mode fantôme, une référence de replay validé permettra au serveur
de reprendre sa graine et sa version, avec **un nouveau `runId`** et une nouvelle
propriété. Aucun stockage ni endpoint de fantôme n'est livré ici.

## 3. Soumission compatible avec RunResult

`POST /api/run`, session requise, corps `RunResult` de l'interface existante :

```ts
type SubmitRunBody = {
  runId: string
  pseudo: string
  seed: string
  simulationVersion: string
  score: number
  coins: number
  tickCount: number
  inputs: Array<{
    lane: -1 | 0 | 1
    action: 'none' | 'jump' | 'crouch'
  }>
}
```

`playerId` n'est pas accepté dans ce corps : il vient exclusivement de la session.
Le serveur cherche le `runId` et vérifie son propriétaire ; un identifiant absent
ou appartenant à un autre joueur rend la même erreur `404 RUN_NOT_FOUND`.
`pseudo`, `seed` et `simulationVersion` doivent correspondre à l'enregistrement
de création. Le pseudo comparé est celui de la partie, même si la session a depuis
changé de nom. Les valeurs du corps ne remplacent jamais celles du serveur.

Ordre de validation prévu :

1. Vérifier session, origine, JSON, taille brute du corps et débit.
2. Vérifier propriété, paramètres, version supportée et expiration de la partie.
   Une répétition déjà prise en charge récupère son état même après expiration
   de la fenêtre initiale, tant que la session du propriétaire reste valide.
3. Exiger des entiers finis sûrs, non négatifs pour score et pièces, strictement
   positif pour `tickCount`, avec `inputs.length === tickCount`. Une entrée
   correspond exactement à un tick. Refuser clés inattendues et actions/couloirs
   invalides. Les maxima de ticks, d'octets et de gains dépendent de la version du
   moteur et seront fixés après essais ; ils doivent être appliqués avant le rejeu.
4. Réserver atomiquement la soumission avec une empreinte du corps normalisé.
   Persister les commandes pour reprendre le travail après arrêt du processus.
5. Initialiser **le même module pur** avec la graine et la version enregistrées.
   Appliquer `inputs[0]` au premier tick puis une entrée par tick, exactement
   `tickCount` fois, sans avancer durant les pauses caméra. La convention précise
   du premier tick doit être figée avec l'API du moteur.
6. Vérifier que l'état terminal autorisé arrive au dernier tick annoncé, sans
   commandes après la fin ni arrêt prématuré ; recalculer score et pièces.
   Refuser toute divergence avec `422 REPLAY_MISMATCH` ou `422 INVALID_END_STATE`.
7. Persister le résultat recalculé et une tâche d'envoi unique. Le relayer transmet
   uniquement ce résultat à `submitRun(runId, playerId, score, coins)`.

Le serveur ne se contente jamais de bornes ou du score annoncé. Si le module ou
la version ne sont pas disponibles, refuser l'acceptation (`503 REPLAY_UNAVAILABLE`)
et ne créer aucune tâche créditable. La formule de score, les actions maintenues,
la durée maximale et les fins valides restent à définir avec le front.
Le rejeu vérifie la cohérence des inputs, pas leur origine corporelle.

## 4. Réponses et suivi

Pour une demande prise en charge : `202` tant que le travail est en cours,
`200` si son enregistrement est confirmé selon la politique réseau retenue.
`GET /api/runs/:runId`, avec la même session propriétaire, expose le même état.
Ces réponses et toutes les réponses de session portent `Cache-Control: no-store`.

```ts
type RunSubmission = {
  runId: string
  status: 'validating' | 'queued' | 'submitted' | 'confirmed' | 'rejected'
  result: { score: number; coins: number } | null
  transactionHash: string | null
  error: { code: string; message: string } | null
}
```

`result` est nul avant réussite du rejeu et contient ensuite les valeurs serveur.
`transactionHash` est nul jusqu'à diffusion ; un hash seul n'est pas une
confirmation. Les erreurs métier terminales de rejeu rendent `422` et sont
retrouvables via le suivi (`rejected`). Une indisponibilité RPC conserve la tâche
en attente, avec reprise, sans faire passer une partie validée à un rejet métier.

| HTTP | Code proposé | Traitement client |
| --- | --- | --- |
| 400 | `INVALID_BODY` | Corriger le format avant enregistrement de la soumission |
| 401 | `SESSION_REQUIRED` | Rétablir une session valide ; ne pas réattribuer un ancien run |
| 403 | `ORIGIN_REJECTED` | Requête hors origine autorisée |
| 404 | `RUN_NOT_FOUND` | Partie inaccessible |
| 409 | `RUN_PARAMETERS_MISMATCH`, `RUN_PAYLOAD_CONFLICT`, `IDEMPOTENCY_CONFLICT` | Ne pas modifier une partie ou une soumission déjà réservée |
| 410 | `RUN_EXPIRED` | Créer une nouvelle partie |
| 413 | `PAYLOAD_TOO_LARGE` | Corps au-delà du budget de rejeu |
| 422 | `REPLAY_MISMATCH`, `INVALID_END_STATE` | Résultat refusé, nouvelle partie nécessaire |
| 429 | `RATE_LIMITED` | Respecter `Retry-After` |
| 503 | `REPLAY_UNAVAILABLE`, `STORAGE_UNAVAILABLE` | Réessayer le même run après rétablissement |

Les erreurs avant prise en charge utilisent `{ "error": { "code": "…", "message": "…" } }`.
Ne jamais exposer de secret ou d'information sur une session tierce dans ces messages.
Les nombres de partie restent des entiers JavaScript sûrs, également convertibles
en `uint64`. Les futurs agrégats on-chain (`uint128` pour les pièces) seront exposés
en chaînes décimales JSON, sans conversion perdant de précision vers `number`.

## 5. Persistance et idempotence sur Vercel

Un objet JavaScript, un fichier local ou un verrou en mémoire ne suffit pas entre
invocations Vercel. Il faut un stockage durable avec contraintes uniques,
transactions ou opérations atomiques équivalentes. Le fournisseur reste ouvert.

| Donnée persistée | Contraintes indispensables |
| --- | --- |
| Joueur | `playerId` unique, pseudo d'affichage distinct de l'identité |
| Session | Empreinte de jeton unique, propriétaire, expiration, révocation |
| Partie | `runId` unique, joueur, pseudo initial, graine, version, expiration, cible réseau/contrat |
| Création idempotente | Unicité `(playerId, idempotencyKey)`, empreinte de requête et partie associée |
| Soumission | Une empreinte immuable par run, inputs persistés, résultat recalculé, état et bail de traitement |
| Tâche relayer | Une par run, nonce, transaction signée privée, hash(s), reçu, bloc, reprises |

L'empreinte couvre tous les champs de `RunResult`, dont l'ordre des inputs, dans
un encodage canonique versionné : changer l'ordre des clés JSON ne doit pas créer
une nouvelle soumission. Deux demandes identiques récupèrent le même état ;
deux corps différents pour un run déjà réservé donnent `409 RUN_PAYLOAD_CONFLICT`.
Après rejet de rejeu, conserver l'empreinte et le rejet ; une tentative corrigée
ne remplace pas le résultat de cette même partie.

Une réservation `validating` doit utiliser un bail persistant renouvelable et
une écriture conditionnelle par génération du bail : un worker expiré ne peut
plus publier un résultat. Un worker de reprise peut rejouer la même soumission.
Enregistrer le résultat validé et sa tâche d'envoi dans la même transaction
durable (outbox), afin qu'un arrêt entre les deux ne perde pas un crédit.
Ne pas lancer une promesse en arrière-plan sans mécanisme durable de reprise.

Le contrat rejette globalement tout `runId` déjà utilisé, même avec un autre
joueur. En cas de réponse RPC perdue, réconcilier reçu et événement `RunSubmitted`
avec le run, le joueur et les valeurs recalculées avant de confirmer. Lire
`processedRuns(runId)` seul ne prouve pas que les données attendues ont été
enregistrées. Garder l'état et la preuve d'idempotence après expiration du cookie.

## 6. Nonces du relayer et reprises

Proposition : une file durable et un seul émetteur logique par
`(chainId, relayerAddress)`. Ce choix doit être concret avant l'intégration.
Un verrou persistant avec bail et contrôle de génération, ou un allocateur
transactionnel de nonces, doit garantir l'unicité des réservations.

Réserver le nonce avec la tâche, signer, puis persister la transaction signée et
son hash **avant** de la diffuser. Après une erreur réseau, rechercher le hash et
rediffuser les mêmes octets si nécessaire ; ne pas allouer aveuglément un autre
nonce. Un remplacement contrôlé conserve nonce et calldata, adapte les frais et
conserve tous les hashes associés. Réconcilier transactions en attente, reçus,
remplacements et éventuelles réorganisations avant de libérer un nonce.

Une lecture isolée du nonce `pending` suivie d'un essai supplémentaire n'est pas
une coordination. Toutes les écritures futures de cette clé, y compris achats
optionnels, doivent utiliser le même mécanisme. Aucun script concurrent ne doit
diffuser avec cette clé hors de cette file. Un reçu doit être réussi et correspondre
au contrat et à l'événement attendus ; la politique de confirmation/finalité reste
à valider avec le RPC retenu avant d'afficher le statut `confirmed`.

## 7. Décisions à clore avant le prochain lot

- Fournisseur de stockage, transactions atomiques, file durable et worker de reprise.
- Durée/révocation des sessions, changement de joueur sur borne et récupération.
- API et version de `shared/game/`, encodage de graine, fréquence, fins et bornes de rejeu.
- Conservation des inputs, quotas et stockage éventuel des fantômes ; aucune vidéo.
- Émetteur/allocateur de nonces, RPC, politique de confirmation et budget de calcul Vercel.

Tests d'intégration attendus au prochain lot : sessions distinctes avec même pseudo,
accès à un run tiers, falsification de graine/version, rejeu réel accepté/refusé,
requêtes simultanées, réponse perdue, expiration de bail et reprise après crash
avant/après diffusion. Ils ne sont pas remplacés par les tests Solidity du lot 1.

## 8. Top 25 et résolution des pseudos

Le contrat expose désormais `getLeaderboard()` : un seul appel de lecture renvoie
un tableau de 0 à 25 tuples `{ playerId: bytes32, score: uint64 }`. Un joueur figure
au plus une fois avec son meilleur score strictement positif. Le tri est décroissant
par score, puis croissant par `playerId` numérique en cas d'égalité.
Voir les [règles et le calcul local des cibles](backend-monad.md#top-25-historique).

Les pseudos restent dans le stockage de joueurs proposé. À l'intégration, le futur
back devra résoudre en une lecture groupée les identifiants exacts de l'instantané
chargé par le front, ou lire et enrichir lui-même cet instantané. Ne pas relire
un nouveau classement pendant la résolution des pseudos : il pourrait contenir
d'autres joueurs. La route de lecture/enrichissement reste à choisir ; aucune
route n'est ajoutée dans ce lot.

Format JSON proposé pour un instantané enrichi :

```ts
type LeaderboardSnapshot = {
  entries: Array<{
    playerId: string
    score: string
    pseudo: string | null
  }>
}
```

`playerId` conserve ses 32 octets en hexadécimal minuscule, préfixés par `0x`.
`score` est une chaîne décimale canonique positive, comprise entre `"1"` et
`"18446744073709551615"`, sans exposant ni arrondi. L'adaptateur JSON utilise
`score.toString()` depuis le `bigint` décodé ; le client utilise `BigInt(score)`.
Ne jamais faire transiter un `uint64` arbitraire par `Number`, même si les scores
du moteur actuel sont limités aux entiers sûrs. Conserver l'ordre du contrat.

`pseudo` est le nom d'affichage courant du joueur dans la base, pas celui d'une
session tierce retournée au client. Une identité non résolue donne `null`, avec
affichage d'un identifiant abrégé ; aucun jeton, cookie ou champ privé n'est exposé.
Les noms doivent être rendus comme texte échappé. Le score vient uniquement du
contrat et n'est pas remplacé par une valeur de cache utilisateur.

Le client conserve l'instantané au début de la partie, exclut le `playerId` de sa
session et choisit le score strictement supérieur le plus proche. Il affiche la
différence avec son score courant en `bigint`, puis passe aux cibles suivantes
quand elles sont atteintes ou dépassées. Sans cible, il affiche un état explicite.
Aucune requête par frame, aucun recalcul on-chain, aucune transaction de lecture.
Le top 25 porte sur cette instance du contrat et sur les résultats acceptés, pas
sur des pseudos uniques ni une preuve d'authenticité des mouvements.
