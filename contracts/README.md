# Contrat MonadSurf — résultats et top 25

Contrat autonome de résultats, sans dépendance Solidity. Les tests s'exécutent
localement, sans RPC, wallet ni clé privée. Aucun contrat n'est déployé par ce lot.

## Exécuter les tests

Depuis la racine du dépôt, avec Foundry et solc 0.8.24 disponibles :

```sh
SVM_HOME="$PWD/contracts/.svm" FOUNDRY_DIR="$PWD/contracts/.foundry" \
  forge test --root contracts -vv
forge fmt --root contracts --check
```

Foundry peut télécharger le compilateur manquant dans `contracts/.svm`.
Pour travailler hors réseau, placer un binaire solc 0.8.24 compatible avec la
machine dans `contracts/.tools/solc-0.8.24`, puis utiliser :

```sh
SVM_HOME="$PWD/contracts/.svm" FOUNDRY_DIR="$PWD/contracts/.foundry" \
  forge test --root contracts --use "$PWD/contracts/.tools/solc-0.8.24" --offline -vv
```

Le binaire local utilisé pour ce lot provient du cache Hardhat déjà présent sur
la machine ; sa version vérifiée est `0.8.24+commit.e11b9ed9`. Il reste ignoré,
comme les sorties, caches et éventuels journaux de diffusion. Aucune installation
globale, dépendance frontend ou bibliothèque `forge-std` n'est nécessaire.
L'interface `Vm` du test expose seulement les cheatcodes utilisés.

## Vérifications du lot

30 tests réussis avec Foundry **1.5.1**, solc **0.8.24**, cible EVM **Cancun**.
Trois tests génératifs exécutent chacun 256 cas. Ils couvrent :

- accès réservé au relayer, y compris refus du déployeur et d'adresses arbitraires ;
- rejet d'un relayer nul et d'identifiants nuls, sans consommation de partie ;
- doublon identique, résultat modifié et réattribution d'un run à un autre joueur ;
- isolation des joueurs, meilleur score, égalité, cumul des pièces et des parties ;
- résultat nul, joueur inconnu, événement et cumul dépassant `uint64` ;
- top vide, partiel, plein, 26e entrée, éviction et retour d'un joueur ;
- ordre des égalités, amélioration sans doublon, soumissions rejetées ;
- absence d'écritures du classement pour un résultat qui ne le modifie pas ;
- correspondance avec les records de 32 joueurs après chaque soumission de séquences
  générées de 64 parties, avec tri, capacité, unicité et précision des scores.

Ces tests vérifient la logique dans une EVM locale. Le chain ID local `10143`
ne reproduit pas à lui seul les règles d'exécution ou les coûts de Monad.
Les chiffres de gas affichés par cette suite ne sont pas des mesures Monad.

Contrôles du socle également réussis : `pnpm typecheck` et `pnpm build`, avec
Node.js `24.21.0` et pnpm `10.34.5`. `forge fmt --root contracts --check` réussit.
Les liens locaux des trois documents backend ont été vérifiés.

## Interface et intégration future

Voir [la spécification du contrat](../docs/backend-monad.md) et
[la proposition d'API](../docs/backend-api.md).
L'artefact compilé, incluant l'ABI, est
`contracts/out/MonadSurf.sol/MonadSurf.json` ; il est généré et ignoré.

`getLeaderboard()` renvoie de 0 à 25 structures `{ playerId: bytes32, score: uint64 }`,
triées par score décroissant puis identifiant croissant. Seul le meilleur score
strictement positif de chaque joueur figure dans ce classement. L'intégration
devra charger un instantané au début du jeu et calculer les écarts en local,
en conservant les scores en `bigint` ou en chaînes décimales pour JSON.

Avant tout déploiement, reprendre les tests avec **Foundry 1.8 ou supérieur**
et le réseau d'exécution Monad (`--network monad`), comme indiqué par la
[documentation Monad](https://docs.monad.xyz/guides/deploy-smart-contract/foundry).
Conserver les versions du compilateur et la configuration des artefacts vérifiés.
Les paramètres de déploiement et les vérifications réseau sont décrits dans la
spécification ; ce lot ne fournit aucun script diffusant une transaction.

Références Foundry : [configuration](https://getfoundry.sh/config/overview/),
[tests](https://getfoundry.sh/forge/tests/overview/),
[compilateur](https://getfoundry.sh/config/reference/solidity-compiler/).
