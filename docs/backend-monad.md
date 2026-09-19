# Backend et contrat Monad — résultats et top 25

Le contrat de résultats et son top 25 historique sont implémentés dans
[contracts/src/MonadSurf.sol](../contracts/src/MonadSurf.sol) et testé localement.
Il remplace l'ancienne ébauche de ce document, qui identifiait les joueurs par leur
pseudo et ne protégeait pas contre les doubles crédits. Aucun déploiement,
transaction réseau, serveur de session ou validateur de rejeu n'est livré ici.

Les décisions produit restent dans [PROJECT.md](../PROJECT.md). Le contrat d'API
pour le prochain lot est proposé dans [backend-api.md](backend-api.md), en accord
avec [interface.md](interface.md).

## 1. Contrat livré

Un seul contrat, `MonadSurf`, sans proxy, NFT, token, boutique ni fantômes.
Le constructeur reçoit une adresse `relayer_` non nulle, stockée de façon immuable.
Seule cette adresse peut enregistrer un résultat. Le déployeur n'a aucun privilège
supplémentaire. Une rotation de clé nécessiterait un nouveau contrat et une décision
explicite sur la reprise des données ; aucune migration n'est fournie dans ce lot.

Le serveur crée et conserve un `playerId` interne non nul de 32 octets, associé à
une session authentifiée. Un pseudo est seulement un nom d'affichage hors chaîne.
Le contrat ne reçoit ni pseudo, ni cookie, ni inputs, ni vidéo.

```solidity
struct Player {
    uint64 bestScore;
    uint128 coins;
    uint64 runs;
}
```

Les trois champs occupent un slot. Le solde de pièces cumulé est plus large que
les gains d'une partie. Les additions gardent les contrôles de dépassement Solidity :
un dépassement annule toute l'écriture, y compris la consommation du `runId`.
Aucun score maximal métier n'est défini dans le contrat ; les limites dépendent
du moteur partagé et seront appliquées avant la signature serveur.

## 2. Interface publique

| Interface | Effet |
| --- | --- |
| `constructor(address relayer_)` | Fixe l'unique adresse autorisée, rejette l'adresse nulle |
| `submitRun(bytes32 runId, bytes32 playerId, uint64 score, uint64 coins)` | Enregistre un résultat validé par le relayer |
| `getPlayer(bytes32 playerId)` | Renvoie `(uint64 bestScore, uint128 coins, uint64 runs)` dans une structure `Player` |
| `getLeaderboard()` | Renvoie les 0 à 25 entrées classées `(bytes32 playerId, uint64 score)` en un appel |
| `processedRuns(bytes32 runId)` | Indique si la partie a déjà été enregistrée |
| `relayer()` | Renvoie l'adresse autorisée |

`getPlayer` renvoie une structure nulle pour un joueur inconnu ; `runs > 0`
indique qu'au moins une partie a été enregistrée. Un score nul avec zéro pièce
reste une partie et consomme son identifiant.

`submitRun` vérifie le relayer, les deux identifiants non nuls et l'absence de
crédit antérieur. Il marque ensuite la partie utilisée, conserve le maximum des
scores, actualise le top 25 si le record personnel augmente, additionne les pièces
et incrémente le compteur de parties. L'événement existant reste inchangé.
Toutes ces écritures sont atomiques, sans appel externe.

```solidity
event RunSubmitted(
    bytes32 indexed runId,
    bytes32 indexed playerId,
    uint64 score,
    uint64 coins
);
```

Les valeurs de l'événement sont celles de la partie, pas les agrégats du joueur.
Il permet de rapprocher un reçu du résultat serveur et de reconstruire l'historique
si le fournisseur conserve les logs nécessaires. Aucun indexeur n'est ajouté.

| Erreur personnalisée | Condition |
| --- | --- |
| `InvalidRelayer()` | Adresse nulle au déploiement |
| `NotRelayer()` | Appel d'écriture non autorisé |
| `InvalidRunId()` | Identifiant de partie nul |
| `InvalidPlayerId()` | Identifiant de joueur nul |
| `RunAlreadySubmitted(bytes32 runId)` | Partie déjà enregistrée, quel que soit le joueur annoncé |

Le `runId` est unique **globalement dans ce contrat**, pas seulement par joueur.
Si deux transactions soumettent le même identifiant, au plus une crédite la partie ;
l'autre échoue sans modifier les statistiques. Le serveur doit éviter le second
paiement de transaction grâce à son idempotence persistante. Un nouveau déploiement
possède son propre registre : aucune protection inter-contrats n'est implicite.

Le contrat fait confiance au relayer pour les résultats et le rattachement des
parties aux joueurs. Il n'effectue ni rejeu ni preuve de mouvement. Le serveur doit
recalculer score et pièces avec la simulation partagée **avant** de signer.

### Top 25 historique

Hypothèse produit retenue : **un seul meilleur score par `playerId`**, donc au
maximum 25 joueurs distincts, et non les 25 meilleures parties d'un même joueur.
Le classement persiste entre parties, sans remise à zéro de session ou de saison.
« All-time » porte sur les résultats acceptés par cette instance du contrat.

```solidity
struct LeaderboardEntry {
    bytes32 playerId;
    uint64 score;
}

function getLeaderboard() external view returns (LeaderboardEntry[] memory);
```

L'ABI renvoie un `tuple[]` dynamique avec les champs `playerId: bytes32` et
`score: uint64`. Le tableau contient uniquement les entrées présentes : aucune
case vide à filtrer et aucune pagination.

Règles déterministes :

- scores strictement positifs, triés du plus élevé au plus faible ;
- à score égal, le plus petit `playerId` en valeur entière non signée sur 256 bits
  passe devant, indépendamment de l'ordre d'arrivée ;
- un score nul crédite normalement la partie et ses pièces, mais n'entre pas au top ;
- une amélioration reclasse le joueur sans doublon ; à capacité pleine, une nouvelle
  entrée mieux classée évince la dernière, sans supprimer ses statistiques ;
- un joueur évincé peut revenir en améliorant son record suffisamment pour se classer.

Un résultat inférieur ou égal au record personnel ne touche pas au classement.
Un nouveau record insuffisant pour entrer ne provoque aucune écriture dans le top.
La recherche et les décalages parcourent seulement les 25 entrées au maximum,
sans énumérer les joueurs ni leurs anciennes parties. Le compteur de parties,
les pièces et l'anti-double crédit continuent à être actualisés indépendamment.
Une soumission rejetée ne modifie ni le classement ni les statistiques.

### Lecture au début de la partie et cible locale

Le front devra charger une fois `getLeaderboard()` au lancement et conserver cet
instantané jusqu'à la fin de la partie. Le futur backend devra résoudre les
`playerId` vers leurs pseudos par une lecture groupée de sa table de joueurs.
Le pseudo n'est jamais extrait de l'identifiant ou utilisé comme autorisation.
Le [format d'enrichissement proposé](backend-api.md#8-top-25-et-résolution-des-pseudos)
prévoit un pseudo nul si le nom n'est pas disponible ; afficher alors un identifiant
abrégé. Aucun endpoint ni rendu frontend n'est implémenté dans ce lot.

À partir du score courant et en excluant son propre `playerId` :

1. Chercher le plus petit score **strictement supérieur** au score courant.
2. Si plusieurs joueurs ont ce score, conserver celui au plus petit `playerId`.
3. Afficher l'écart `scoreCible - scoreCourant` et le nom de la cible.
4. À chaque progression locale, refaire cette sélection sur le même instantané.
   Atteindre ou dépasser une cible passe à la suivante, même si plusieurs seuils
   ont été franchis d'un coup. Les égalités déjà atteintes ne sont plus des cibles.

Exemple : avec des adversaires à `400`, `700` et `1000`, un score courant de `350`
affiche un écart de `50`. À `400`, la cible devient `700` et l'écart `300` ; à
`720`, la cible devient `1000` et l'écart `280`. C'est l'écart qui décroît pendant
l'approche d'une cible, **jamais le score historique stocké**.

Sans cible supérieure, afficher « Aucun score supérieur dans cet instantané ».
Un top vide peut afficher « Aucun score enregistré » ; une erreur de chargement
doit afficher « Classement indisponible », sans inventer de cible. Il s'agit
uniquement des autres joueurs du top 25 chargé, pas de tous les joueurs historiques
ni d'un classement mis à jour en direct. Aucune transaction ni requête par frame.

Conserver les `uint64` décodés en `bigint`. Pour JSON, sérialiser chaque score en
chaîne décimale et le relire avec `BigInt(score)` ; ne pas passer par `Number`.
La borne `18446744073709551615` dépasse la précision exacte d'un `number` JavaScript.
Si le moteur fournit un `number`, vérifier qu'il est entier sûr et non négatif
avant `BigInt(scoreCourant)` ; comparer et soustraire en `bigint` puis formater
le résultat en texte. Les types partagés du moteur restent inchangés.

## 3. Vérification locale

Voir [contracts/README.md](../contracts/README.md) pour les commandes reproductibles.
Configuration isolée dans `contracts/`, sans dépendance Solidity ou frontend.
Le compilateur est fixé à solc 0.8.24 et la cible de compilation à Cancun.
Les sorties et le compilateur local sont exclus par `contracts/.gitignore`.

30 tests réussis avec Foundry 1.5.1, dont trois tests génératifs de 256 cas chacun :
accès relayer, doublons identiques ou modifiés, réattribution interdite, isolation,
meilleur score, cumul des pièces/parties, événement, identifiants nuls et bornes
arithmétiques par partie. Les 16 tests initiaux sont conservés. Les 14 tests ajoutés
couvrent le top vide, partiel, plein, les évictions et réentrées, les égalités,
les scores nuls, la précision `uint64` et l'absence de changement après rejet.
L'enregistrement des accès au stockage vérifie l'absence d'écritures inutiles dans
le classement. Le nouveau fuzz compare le top à un calcul indépendant des records
de 32 joueurs après chacune des 64 soumissions de chaque cas : tri, capacité,
unicité et scores sont ainsi contrôlés sur des séquences d'améliorations.
Ces tests s'exécutent hors réseau, sans clé.

La suite est une vérification de logique EVM, pas une mesure des règles ou du gas
Monad. Le chain ID local `10143` ne transforme pas Foundry 1.5.1 en moteur Monad.
Avant un déploiement, reprendre ces tests avec Foundry 1.8 ou supérieur et
`--network monad`, selon la
[documentation officielle](https://docs.monad.xyz/guides/deploy-smart-contract/foundry).
Aucun chiffre de gas ou délai de finalité n'est validé par ce lot.

## 4. API et persistance à intégrer

La [proposition détaillée](backend-api.md) décrit les routes suivantes ; elles
n'existent pas encore dans `server/` :

| Méthode et route | Responsabilité future |
| --- | --- |
| `POST /api/session` | Créer/reconnaître un joueur par cookie opaque, associer le pseudo |
| `POST /api/runs` | Allouer `runId`, graine et version autorisées, persister le propriétaire |
| `POST /api/run` | Valider un `RunResult` par rejeu et programmer son enregistrement unique |
| `GET /api/runs/:runId` | Retrouver l'état et le hash après une réponse perdue |

La session sera liée à un identifiant interne ; saisir le pseudo d'un autre joueur
ne donne aucun accès à ses parties. Cookie de production `HttpOnly`, `Secure`,
`SameSite=Lax`, contrôle d'origine et stockage durable sont proposés.
Durées, récupération et changement de joueur sur une borne restent ouverts.

Les requêtes Vercel doivent partager un stockage avec unicité de partie, empreinte
immuable de soumission et tâche relayer durable. Les transitions et reprises après
crash demandent des opérations atomiques ; un cache ou verrou mémoire ne suffit pas.
La gestion des nonces doit sérialiser les envois par clé ou les réserver de manière
transactionnelle, avec réconciliation des transactions signées et diffusées.
Le fournisseur de stockage et le mécanisme de file/worker restent à choisir.

Les lectures on-chain de `getPlayer` et `getLeaderboard` sont publiques. Le top 25
fournit directement sa liste de joueurs ; le futur backend doit seulement enrichir
ces identifiants avec les noms hors chaîne. Il n'y a pas d'énumération globale de
tous les joueurs. L'affichage et la résolution des pseudos restent à intégrer.

## 5. Paramètres du futur déploiement

Cible : **Monad testnet, chain ID `10143`**. Vérifier que le RPC retenu renvoie cet
identifiant avant toute signature. Références :
[réseau testnet](https://docs.monad.xyz/developer-essentials/testnet) et
[guide Foundry](https://docs.monad.xyz/guides/deploy-smart-contract/foundry).

| Paramètre | Valeur ou choix nécessaire |
| --- | --- |
| Contrat | `contracts/src/MonadSurf.sol:MonadSurf` |
| Compilateur / optimisation | solc `0.8.24`, optimiseur actif, `optimizer_runs = 200` |
| Cible de compilation | EVM `cancun`, fixée dans `contracts/foundry.toml` |
| Exécution de validation réseau | Foundry ≥ 1.8, `--network monad` ; revalider la configuration avec cette version |
| Constructeur | `relayer_` : adresse non nulle du signataire serveur |
| RPC | `MONAD_RPC_URL`, endpoint testnet choisi, quotas à vérifier |
| Signataire du déploiement | Compte local chiffré/keystore à préparer dans un lot autorisant le déploiement |
| Signataire des résultats | `RELAYER_PRIVATE_KEY`, uniquement serveur |
| Adresse déployée | `CONTRACT_ADDRESS`, à renseigner après déploiement |

Aucun secret n'est nécessaire pour les tests. Les secrets futurs et le RPC privé
restent hors bundle client et hors `runtimeConfig.public`. Ne pas copier de clé
privée dans une commande, un document ou un fichier partagé.

Avant publication : revalider la compilation et les tests sous l'environnement
Monad, vérifier le réseau et l'adresse relayer, estimer les opérations réellement
supportées, puis conserver l'ABI, les paramètres, l'adresse et le reçu de déploiement.
Les bornes de gas et la politique de confirmation doivent venir d'essais du réseau
cible ; un hash ou un reçu ne suffit pas à annoncer une finalité mesurée.
La diffusion d'une transaction reste hors de ce premier lot.

## 6. Prochain lot et choix ouverts

1. Figer avec le front l'API de `shared/game/`, la graine, la version et les bornes
   des ticks, commandes, scores et pièces. Aucun moteur alternatif n'est créé ici.
2. Choisir stockage durable, sessions, rétention des replays et file/coordination
   des nonces adaptée à Vercel.
3. Implémenter le rejeu réel, les routes et les reprises idempotentes, avec tests
   de concurrence et de crash. Refuser toute acceptation si le moteur est indisponible.
4. Préparer ensuite un déploiement autorisé et l'intégration du suivi des résultats.

Boutique, skins et stockage des fantômes restent hors lot. Avec ce contrat sans
proxy, ajouter des écritures de boutique demanderait un nouveau déploiement et une
stratégie explicite de conservation des soldes. Le format et l'emplacement des
fantômes restent ouverts ; leurs graines, versions, ticks et inputs devront être
conservés, sans vidéo.
