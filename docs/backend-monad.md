# Spécification backend et contrat Monad

Périmètre : le contrat, les sessions, les routes serveur Nuxt et le relayer.
Les décisions produit sont dans [PROJECT.md](../PROJECT.md). Les formats techniques
et le stockage des replays restent à préciser avant l'implémentation.

## 1. Décisions structurantes

**Pas de wallet joueur.** Le joueur saisit un pseudo. Une clé relayer unique, côté
serveur, signe toutes les transactions. Cela supprime la connexion wallet, la
distribution de faucet aux participants, les contraintes de reserve balance et la
gestion de trente comptes pendant la démo.

**Testnet Monad**, chain ID `10143`. Tester le RPC choisi dans les conditions de
la démo et vérifier ses limites auprès du fournisseur.

**Un seul contrat.** Pas de proxy, pas de NFT, pas de token. Les pièces et les skins
sont des entiers dans le contrat.

## 2. Contrat

### Modèle de données

```solidity
struct Player {
    uint32 bestScore;
    uint32 coins;      // solde dépensable
    uint32 runs;
    uint32 skins;      // bitmask des skins possédés
    uint8  equipped;
}
```

Les cinq champs tiennent dans un seul slot de storage.

Un tableau contigu de joueurs et un index d'identité sont proposés. Le coût de
lecture doit être mesuré avec les noms, l'alignement des pages et les accès répétés.
Le coût du premier accès à une page n'est pas celui de tout le classement.
Voir la [tarification officielle](https://docs.monad.xyz/developer-essentials/opcode-pricing).

Deux fantômes sont prévus : celui du joueur précédent et celui du meilleur score.
Ils doivent conserver la graine, la version du moteur, le nombre de ticks, les
commandes et le score de la partie. Le stockage sur le contrat est une proposition ;
il reste à valider selon la taille réelle des replays. Le pseudo seul ne constitue
pas une identité authentifiée.

### Ébauche de contrat importée

Le code ci-dessous est une base de discussion, pas le contrat final. Avant toute
implémentation ou utilisation, il faut l'aligner sur [l'interface](interface.md) :
identifiant de partie non réutilisable, identité issue de la session, métadonnées
complètes des replays, protection des achats déjà possédés et bornes d'entrée.
Actuellement, `submitRun` permet de créditer plusieurs fois la même partie et ne
stocke que les commandes du fantôme. Le seuil `GHOST_MIN_SCORE` désigne le dernier
joueur éligible, pas forcément le joueur précédent ; cette règle reste à décider.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Scores, pièces et skins. Toutes les écritures passent par le relayer.
contract MonadSurf {
    struct Player {
        uint32 bestScore;
        uint32 coins;
        uint32 runs;
        uint32 skins;
        uint8 equipped;
    }

    uint32 public constant GHOST_MIN_SCORE = 500;
    uint8 public constant MAX_SKIN = 32;

    address public immutable relayer;

    Player[] private _players;
    string[] private _pseudos;
    mapping(bytes32 => uint32) private _idOf; // keccak(pseudo) => index + 1

    bytes public lastGhost;
    uint32 public lastGhostId;
    bytes public bestGhost;
    uint32 public bestGhostId;
    uint32 public bestScore;

    event RunSubmitted(uint32 indexed id, string pseudo, uint32 score, uint32 coins);
    event SkinBought(uint32 indexed id, uint8 skin);
    event SkinEquipped(uint32 indexed id, uint8 skin);

    error NotRelayer();
    error UnknownPlayer();
    error InvalidSkin();
    error SkinNotOwned();
    error NotEnoughCoins();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address relayer_) {
        relayer = relayer_;
    }

    function submitRun(
        string calldata pseudo,
        uint32 score,
        uint32 coins,
        bytes calldata inputs
    ) external onlyRelayer {
        uint32 id = _idOrCreate(pseudo);
        Player storage p = _players[id];

        if (score > p.bestScore) p.bestScore = score;
        p.coins += coins;
        p.runs += 1;

        if (score >= GHOST_MIN_SCORE) {
            lastGhost = inputs;
            lastGhostId = id;
            if (score > bestScore) {
                bestScore = score;
                bestGhost = inputs;
                bestGhostId = id;
            }
        }

        emit RunSubmitted(id, pseudo, score, coins);
    }

    function buySkin(string calldata pseudo, uint8 skin) external onlyRelayer {
        if (skin >= MAX_SKIN) revert InvalidSkin();
        uint32 id = _existingId(pseudo);
        Player storage p = _players[id];
        uint32 price = skinPrice(skin);
        if (p.coins < price) revert NotEnoughCoins();
        p.coins -= price;
        p.skins |= uint32(1) << skin;
        emit SkinBought(id, skin);
    }

    function equipSkin(string calldata pseudo, uint8 skin) external onlyRelayer {
        if (skin >= MAX_SKIN) revert InvalidSkin();
        uint32 id = _existingId(pseudo);
        Player storage p = _players[id];
        if (p.skins & (uint32(1) << skin) == 0) revert SkinNotOwned();
        p.equipped = skin;
        emit SkinEquipped(id, skin);
    }

    function skinPrice(uint8 skin) public pure returns (uint32) {
        return skin == 0 ? 0 : uint32(skin) * 250;
    }

    function playerCount() external view returns (uint256) {
        return _players.length;
    }

    function getPlayers(uint32 from, uint32 to)
        external
        view
        returns (Player[] memory list, string[] memory names)
    {
        uint32 end = to > _players.length ? uint32(_players.length) : to;
        uint32 n = end > from ? end - from : 0;
        list = new Player[](n);
        names = new string[](n);
        for (uint32 i = 0; i < n; i++) {
            list[i] = _players[from + i];
            names[i] = _pseudos[from + i];
        }
    }

    function getPlayer(string calldata pseudo) external view returns (Player memory) {
        return _players[_existingId(pseudo)];
    }

    function _idOrCreate(string calldata pseudo) private returns (uint32) {
        bytes32 key = keccak256(bytes(pseudo));
        uint32 slot = _idOf[key];
        if (slot != 0) return slot - 1;
        _players.push(Player({bestScore: 0, coins: 0, runs: 0, skins: 1, equipped: 0}));
        _pseudos.push(pseudo);
        uint32 id = uint32(_players.length - 1);
        _idOf[key] = id + 1;
        return id;
    }

    function _existingId(string calldata pseudo) private view returns (uint32) {
        uint32 slot = _idOf[keccak256(bytes(pseudo))];
        if (slot == 0) revert UnknownPlayer();
        return slot - 1;
    }
}
```

Le skin `0` est possédé par défaut et gratuit. Le tri du classement se fait côté
front, pas dans le contrat.

### Contention et exécution parallèle

Le slot propre à chaque joueur réduit les écritures communes, sans garantir une
absence de conflits. La création d'un joueur, les fantômes globaux et la gestion
transactionnelle du relayer restent partagés.

Une mesure sur des joueurs déjà créés et sans mise à jour de fantôme ne représente
pas le coût du parcours complet. Toute démonstration de charge doit préciser les
conditions mesurées et rester optionnelle après la démo jouable.

### Déploiement

Foundry, avec le support Monad de la version 1.8 ou supérieure.

```
forge create src/MonadSurf.sol:MonadSurf \
  --rpc-url $MONAD_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $RELAYER_ADDRESS
```

Le déployeur et le relayer peuvent être la même clé pour le hackathon.

## 3. Routes serveur

Les écritures passent par le serveur, les lectures non : le front interroge le RPC
directement avec un `publicClient` viem. Moins de code et moins de latence.

| Route | Méthode | Rôle |
| --- | --- | --- |
| Route de création de session, à définir | POST | Attribue une partie et ses paramètres de parcours |
| `server/api/run.post.ts` | POST | Rejoue, vérifie et soumet une partie une seule fois |
| `server/api/skin/buy.post.ts` | POST | Achat d'un skin |
| `server/api/skin/equip.post.ts` | POST | Équipement d'un skin |

### Sessions et soumission d'une partie

Entrée : un `RunResult` tel que proposé dans [interface.md](interface.md).

Le serveur doit créer ou reconnaître une session joueur et une partie identifiée
par `runId`, avec une graine et une version de moteur autorisées. Le mécanisme de
session et sa persistance restent à définir ; saisir un pseudo ne doit pas suffire
pour dépenser les pièces d'un autre joueur.

Traitement attendu :

1. Vérifier la session, l'identifiant de partie et les paramètres attendus.
2. Borner les commandes, le nombre de ticks et les tailles d'entrée.
3. Reconstruire le parcours depuis la graine et rejouer les commandes avec le moteur
   partagé. Recalculer le score et les pièces ; refuser tout écart ou fin invalide.
4. Empêcher deux requêtes concurrentes ou deux tentatives de créditer la même partie.
   Le contrat doit également refuser un identifiant déjà crédité.
5. Faire signer et envoyer la transaction par le relayer, puis retourner son hash.
   Conserver le lien entre partie et transaction pour permettre une reprise après
   une réponse perdue, sans second crédit.

Le rejeu est requis pour accepter une partie. Une simple vérification de bornes
ne remplace pas le calcul du résultat. Les achats et équipements doivent vérifier
la session propriétaire du joueur de la même manière.

### Limite de gas

Le coût de `submitRun` varie : création du joueur, taille du pseudo, taille du replay
et mise à jour des fantômes ne suivent pas tous le même chemin. La limite de
200 000 gas de la proposition initiale n'est donc pas validée.

Mesurer les cas réellement supportés et leurs bornes avant de choisir des limites.
Une limite fixe n'est pertinente que pour des coûts suffisamment connus ; suivre
les [bonnes pratiques Monad](https://docs.monad.xyz/developer-essentials/best-practices).

### Envoi et confirmation

Le serveur renvoie le hash et l'interface suit l'état de la transaction. L'éventuel
usage de `eth_sendRawTransactionSync` doit être vérifié auprès du RPC retenu ;
recevoir un reçu ne doit pas être présenté automatiquement comme la finalisation.
Afficher des délais mesurés, sans garantie de confirmation sous la seconde.

## 4. Gestion des nonces

Sur Vercel, un compteur en mémoire n'est pas partagé entre invocations. Deux requêtes
peuvent lire le même nonce en attente ; relire le nonce et réessayer une fois ne
constitue pas une garantie de coordination.

La stratégie d'envoi doit être définie avant l'intégration : sérialisation des
écritures du relayer ou coordination persistante. Elle doit couvrir les parties,
les achats et les équipements, ainsi que les tentatives après échec réseau.

Un éventuel script local de charge peut gérer ses propres nonces, mais ne doit pas
utiliser en parallèle la même clé qu'un serveur actif sans coordination.

## 5. Variables d'environnement

| Variable | Visibilité | Contenu |
| --- | --- | --- |
| `MONAD_RPC_URL` | privée | endpoint RPC dédié |
| `RELAYER_PRIVATE_KEY` | privée | clé de signature du relayer |
| `CONTRACT_ADDRESS` | publique | adresse du contrat déployé |

Les deux premières restent dans la partie privée de `runtimeConfig` et dans les
variables de production Vercel. Aucune ne doit apparaître dans
`runtimeConfig.public` ni dans le bundle client.

## 6. Ordre de réalisation

1. Préciser les sessions, l'identité, les paramètres de partie et l'anti-double crédit.
2. Aligner et tester le contrat, puis le déployer sur testnet.
3. Intégrer la simulation partagée, le rejeu et la soumission par relayer.
4. Lire le classement et suivre la confirmation dans le front.
5. Conserver et rejouer les fantômes avec leurs métadonnées.
6. Ajouter la boutique si le temps le permet.

Une démonstration de charge reste facultative. Les durées et coûts seront estimés
à partir de l'implémentation ; aucun budget de trois heures n'est garanti.

## 7. Hors périmètre assumé

Pas de wallet, pas de NFT, pas de token, pas de proxy, pas d'indexer, pas de
signature EIP-712, pas de preuve d'authenticité des mouvements.

Un score enregistré ne prouve pas que le joueur a exécuté les mouvements. La
validation par rejeu vérifie la cohérence d'une partie, pas l'origine des inputs.
Cette limite est annoncée telle quelle plutôt que masquée derrière un mécanisme qui
ne la résout pas.
