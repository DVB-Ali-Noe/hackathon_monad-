# Contrat MonadSurf — résultats et top 25

Contrat autonome de résultats, sans dépendance Solidity. Les tests s'exécutent
localement, sans RPC, wallet ni clé privée. Le déploiement testnet est explicite ;
compiler ou tester ne diffuse aucune transaction.

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

## Interface et intégration

Voir [la spécification du contrat](../docs/backend-monad.md) et
[l'API serveur](../docs/backend-api.md).
L'artefact compilé, incluant l'ABI, est
`contracts/out/MonadSurf.sol/MonadSurf.json` ; il est généré et ignoré.

`getLeaderboard()` renvoie de 0 à 25 structures `{ playerId: bytes32, score: uint64 }`,
triées par score décroissant puis identifiant croissant. Seul le meilleur score
strictement positif de chaque joueur figure dans ce classement. L'intégration
charge un instantané au début du jeu et calcule les écarts en local,
en conservant les scores en `bigint` ou en chaînes décimales pour JSON.

## Déploiement Monad testnet

### Contrat déployé

Déploiement confirmé le 19 septembre 2026 sur le réseau `10143` :

- Contrat : [0x9268B8f486c6dDcc92359F3B7799c9Fc1634BcF7](https://testnet.monadvision.com/address/0x9268B8f486c6dDcc92359F3B7799c9Fc1634BcF7).
- Relayer immuable : `0x594CF75585509740F8ae7F148e9e0287BeE098F9`.
- [Transaction de création](https://testnet.monadvision.com/tx/0x71c72fe5f9e3f66b64082712a7c54584e9e33b63cdeadedc13c2f7e28bae4d05), bloc `63898033`, coût `0.059464062 MON`.
- Source vérifiée avec le statut `exact_match` par Sourcify/Blockvision :
  [résultat de vérification](https://sourcify-api-monad.blockvision.org/verify-ui/jobs/643629d6-313d-44df-8362-cc30a7b6f4fd).
- [Manifeste public du déploiement](deployments/monad-testnet.json).

Le bytecode, le relayer et la lecture du top 25 ont été vérifiés après confirmation.
Le classement était vide à la création. La configuration locale de `dev` contient
l'adresse ; celle des services déployés reste à renseigner séparément.

### Préparer et exécuter un déploiement

Utiliser **Foundry 1.8 ou supérieur**, conformément à la
[documentation Monad](https://docs.monad.xyz/guides/deploy-smart-contract/foundry).
Les 30 tests ont aussi été validés avec **Foundry 1.8.3**, solc **0.8.24**,
Cancun et les règles d'exécution Monad Nine :

```sh
forge test --root contracts --network monad --hardfork monad:MonadNine -vv
```

Depuis la racine du worktree, renseigner dans `.env` (ignoré par Git, droits `600`)
`NUXT_MONAD_RPC_URL=https://testnet-rpc.monad.xyz` et `NUXT_RELAYER_PRIVATE_KEY`.
La clé reste privée côté serveur. Son compte sera aussi le **relayer immuable**
du contrat ; il doit disposer de MON testnet pour le déploiement puis les scores.
Laisser `NUXT_MONAD_CONTRACT_ADDRESS` vide pour un premier déploiement.

```sh
# Remplacer ADRESSE_PUBLIQUE par l'adresse du compte attendu.
pnpm deploy:monad --deployer ADRESSE_PUBLIQUE
pnpm deploy:monad --deployer ADRESSE_PUBLIQUE --broadcast
```

La première commande vérifie la clé, le réseau `10143`, la fraîcheur de l'artefact,
le solde et le coût maximal, sans signer ni envoyer. Le plafond par défaut est
`0.2 MON`, ajustable explicitement avec `--max-cost`.

La seconde conserve la transaction signée dans
`contracts/broadcast/monad-testnet.json` avant l'envoi. Relancer **la même commande**
reprend cette transaction ; ne pas supprimer ce journal pour contourner un échec.
Un verrou empêche deux déploiements simultanés. Après un arrêt brutal, ne retirer
son fichier `.lock` qu'après avoir vérifié que le processus est terminé.

Après deux confirmations, le script contrôle le reçu, le bytecode exact, le relayer
et la lecture du classement. Il renseigne l'adresse dans `.env` et écrit les
informations publiques dans `contracts/deployments/monad-testnet.json`.
Cette vérification locale du bytecode ne publie pas le code source sur l'explorateur.
Le déploiement seul ne configure pas PostgreSQL ni le worker de l'API.

Le test `tests/integration/deployment.test.mjs` vérifie sur Anvil les refus de mauvais
compte/réseau, la simulation sans envoi, le contrat obtenu et la reprise sans seconde
création. Il utilise une clé aléatoire et un dossier temporaire, sans lire le `.env`
du projet.

Références Foundry : [configuration](https://getfoundry.sh/config/overview/),
[tests](https://getfoundry.sh/forge/tests/overview/),
[compilateur](https://getfoundry.sh/config/reference/solidity-compiler/).
