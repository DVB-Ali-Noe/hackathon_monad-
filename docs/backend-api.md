# API sans base de données

Toute la persistance métier est dans `MonadSurf` sur Monad testnet (10143) :
pseudos, expiration et révocation des sessions, paramètres des parties, résultats,
pièces, records, top 25 et replays. Aucun PostgreSQL, indexeur ou worker séparé
n’est nécessaire. Le navigateur simule le jeu ; les routes Nuxt rejouent les
commandes avant de signer les écritures. Aucune vidéo n’est transmise.

## Configuration

Renseigner les quatre variables privées de [`.env.example`](../.env.example) :

| Variable | Valeur |
| --- | --- |
| `NUXT_SITE_ORIGIN` | Origine exacte, `http://localhost:3000` en local, `https://hackathon-monad-brown.vercel.app` en production |
| `NUXT_MONAD_RPC_URL` | RPC Monad testnet, par exemple `https://testnet-rpc.monad.xyz` |
| `NUXT_MONAD_CONTRACT_ADDRESS` | Adresse du [manifeste de déploiement](../contracts/deployments/monad-testnet.json) |
| `NUXT_RELAYER_PRIVATE_KEY` | Clé du relayer immuable, uniquement côté serveur |

Sur Vercel, les renseigner dans **Settings → Environment Variables → Production**,
puis redéployer. Aucun secret n’entre dans `runtimeConfig.public` ni dans Git.
Le relayer doit conserver des MON testnet et être réservé à cette application.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

La publication passe par le [workflow existant](../.github/workflows/deploy.yml)
sur `main`. La durée maximale de la fonction Vercel est de 60 secondes.

## Routes

| Route | Fonction |
| --- | --- |
| `POST /api/session` | `{ pseudo }` : crée ou actualise le profil et sa session onchain |
| `DELETE /api/session` | `{}` : révoque la session onchain, puis efface le cookie |
| `POST /api/runs` | `{ requestKey }` : inscrit une partie et renvoie sa graine |
| `POST /api/run` | `RunResult` : rejoue les commandes, enregistre le résultat et le replay |
| `GET /api/runs/:runId` | Lit l’état onchain d’une partie de la session |
| `GET /api/leaderboard` | Lit le top 25 et les pseudos, au même bloc |

Les écritures du navigateur exigent `application/json` et l’`Origin` exact.
Toutes les réponses portent `Cache-Control: no-store`. Les erreurs publiques
ne révèlent ni clé, ni détails internes du RPC.

## Identité et sessions

Un jeton aléatoire de 256 bits reste dans un cookie `HttpOnly`, `SameSite=Strict`,
`Path=/`, valable 30 jours. En HTTPS il est `Secure` et porte le préfixe `__Host-`.
Le `playerId` public est le SHA-256 du jeton ; le jeton lui-même n’est jamais
inscrit sur la blockchain. Connaître le pseudo ou le `playerId` ne permet pas de
se connecter à la session.

Le contrat stocke le pseudo et l’expiration. Chaque requête authentifiée relit
cette expiration. La révocation reste effective après un redémarrage et sur les
autres instances Vercel. Une session révoquée ne peut pas être réactivée ; une
nouvelle identité est créée au prochain départ. Perdre le cookie perd l’accès
à ce joueur, tout en conservant son score public.

Un pseudo est normalisé NFC et limité à 20 unités UTF-16 visibles côté API,
80 octets au maximum dans le contrat. Deux joueurs peuvent porter le même pseudo.
Le changement de pseudo conserve les statistiques et actualise le nom du top 25.
Une partie conserve une copie du pseudo utilisé à son départ.

## Préparation et validation

Le serveur dérive un `runId` du joueur et de `requestKey`, tire une graine aléatoire,
puis inscrit ces paramètres dans le contrat. Une nouvelle tentative avec la même
clé retrouve la même partie. `getRun` conserve son propriétaire, sa graine, le
hash de la version du moteur, son pseudo initial et l’heure du bloc de création.
Une partie non soumise expire après 24 heures.

Le moteur partagé `runner-5-oncoming-60hz` avance à 60 ticks/s. Le serveur vérifie
l’identité, les paramètres onchain, les commandes et la durée réelle écoulée,
puis recalcule score et pièces. La partie doit se terminer exactement au dernier
tick annoncé. Limites : 4 Mio par requête et 108 000 ticks (30 minutes). Une marge
de deux secondes couvre la précision des horloges. Le contrat vérifie également
la durée, la taille du replay, l’expiration et l’unicité du crédit.

Chaque commande est compactée dans un octet : `(lane + 1) * 3 + action`, avec
`none=0`, `jump=1`, `crouch=2`. L’événement `RunSubmitted` contient tous ces octets.
`getRun` conserve leur `keccak256`, le nombre de ticks, le score, les pièces et le
bloc d’enregistrement. Les paramètres et le journal permettent de reconstruire
le replay sans base externe ; la lecture d’historiques anciens dépend de la
rétention des logs du fournisseur RPC.

Le rejeu prouve la cohérence des commandes, pas l’authenticité des mouvements.
Le relayer reste une autorité de validation : aucun rejeu Solidity ni preuve ZK
n’est implémenté.

## Envois, concurrence et reprise

Le serveur attend les écritures dans la requête HTTP. Il relit le nonce confirmé
et le nonce `pending`, attend une transaction déjà en vol, puis signe. Une erreur
RPC rediffuse les mêmes octets signés. Un changement de nonce exige la consommation
du précédent et une nouvelle lecture de l’opération dans le contrat.

Des requêtes concurrentes peuvent viser le même nonce ; elles attendent son
inclusion, relisent l’état et retentent si nécessaire. Le contrat tranche : un
`runId` ne crédite qu’une fois. Un résultat déjà enregistré est renvoyé tel quel ;
un autre résultat pour la même partie provoque un 409.

La boucle de reprise est bornée. Une coupure ou un délai dépassé peut laisser
une transaction se confirmer après l’erreur HTTP. Le bouton de reprise relit
alors le contrat et évite un second crédit. Il n’existe plus de file persistante
hors chaîne : avant diffusion, fermer la page peut nécessiter de renvoyer le
résultat depuis l’écran de fin. Après diffusion, Monad traite la transaction
même si le navigateur et la fonction serveur sont arrêtés. Une transaction
bloquée par des frais insuffisants nécessite une intervention sur son nonce.

Les états publics sont `ready`, `submitted` et `confirmed`. La confirmation
exige le journal attendu dans le bloc canonique et un bloc supplémentaire. Cela
ne constitue pas une promesse de finalité irréversible.

## Limites d’abus

Le contrat autorise au maximum 60 mutations réussies par minute, toutes sessions
et instances confondues. L’API vérifie aussi ce quota avant signature et borne
les frais maximaux d’une transaction à 1 MON. Des limites locales par instance
complètent ce contrôle : 20 appels session/minute/IP, 12 créations et 6 soumissions
par joueur, 30 lectures de classement/IP et 30 lectures d’état/joueur.

Les limites mémoire ne sont pas distribuées. Le quota onchain borne les écritures,
mais un client peut monopoliser ce quota ; aucune protection anti-bot complète
n’est revendiquée pour cette démo testnet.

## Top 25 et affichage en jeu

`getLeaderboard()` renvoie directement `playerId`, `pseudo` et `score`. Les scores
`uint64` deviennent des chaînes décimales JSON, puis des `BigInt` côté navigateur.
Le front recharge à l’ouverture, au début de chaque partie et après confirmation.
Il exclut le joueur courant et affiche l’écart vers le score strictement supérieur
le plus proche. Cet écart diminue localement ; aucune requête ne part par tick.

Une erreur affiche « Leaderboard unavailable ». Un top vide réussi affiche
explicitement l’absence de score ; il ne simule aucun adversaire. Sans backend
configuré au départ, le jeu annonce une partie locale non enregistrée.

## Vérification

```sh
pnpm test
pnpm typecheck
pnpm build
# Compiler également le contrat avec Forge avant :
pnpm test:integration
```

Les tests d’intégration lancent Anvil et deux serveurs Nuxt sans Docker ni base.
Ils vérifient sessions, révocation entre instances, rejeu, concurrence, unicité,
pseudos et replays onchain, puis reprise après redémarrage. Le test de déploiement
utilise un wallet aléatoire alimenté uniquement dans cette EVM locale.
