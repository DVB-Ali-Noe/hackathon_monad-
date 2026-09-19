# MonadSurf — profils, parties et classement onchain

Contrat autonome sans dépendance Solidity. Il conserve pseudos, expiration et
révocation des sessions, paramètres des parties, résultats, pièces et top 25.
Les commandes des replays sont conservées dans les événements. Le serveur rejoue
la simulation avant d’écrire ; le cookie secret et la vidéo restent hors chaîne.

## Contrat déployé

Version sans base externe déployée le 19 septembre 2026 sur Monad testnet `10143` :

- [Contrat `0xee4251dA27B7F136F9641542e64C8758841e13e3`](https://testnet.monadvision.com/address/0xee4251dA27B7F136F9641542e64C8758841e13e3).
- Relayer immuable : `0x594CF75585509740F8ae7F148e9e0287BeE098F9`.
- [Transaction de création](https://testnet.monadvision.com/tx/0x175c9a73a283e49af2022f1cee06b7e7a5e19a42d15458a469a192d18208c066), bloc `63909014`, gas consommé `1725645`.
- Source vérifiée `exact_match` par [Sourcify/Blockvision](https://sourcify-api-monad.blockvision.org/verify-ui/jobs/acda1ef7-61a2-4cb0-ac54-828da28bacdb).
- [Manifeste actif](deployments/monad-testnet.json), avec empreintes du source et du bytecode.

Le bytecode exact, le relayer et le classement ont été contrôlés après deux
confirmations. L’adresse est configurée dans le `.env` local et dans Vercel.
L’[ancien déploiement](deployments/monad-testnet-v1.json), sans pseudos ni sessions,
reste archivé. Son classement était vide lors du remplacement ; aucune donnée
joueur n’a été migrée ou supprimée.

## Tests

Foundry 1.8 ou supérieur et solc 0.8.24 :

```sh
forge test --root contracts --network monad --hardfork monad:MonadNine -vv
forge fmt --root contracts --check
```

Avec le compilateur local ignoré par Git :

```sh
forge test --root contracts --use "$PWD/contracts/.tools/solc-0.8.24" \
  --offline --network monad --hardfork monad:MonadNine -vv
```

32 tests passent sous Foundry 1.8.3, dont trois tests génératifs de 256 cas.
Ils couvrent profils et pseudos, expiration et révocation, autorisations,
paramètres et replays, quotas partagés, agrégats, doubles crédits et top 25.
Les tests de classement vérifient capacité, tri, égalités, évictions, absence de
doublons, précision `uint64` et absence d’écritures inutiles.

Après `pnpm build`, `pnpm test:integration` lance Anvil et deux instances Nuxt.
Les sessions et résultats survivent aux redémarrages grâce à l’état onchain ;
les requêtes simultanées sont testées sans Docker ni PostgreSQL.

## Déploiement reproductible

Renseigner `NUXT_MONAD_RPC_URL` et `NUXT_RELAYER_PRIVATE_KEY` dans un `.env` local
ignoré, droits `600`. Le wallet doit disposer de MON testnet. Pour un premier
déploiement, laisser `NUXT_MONAD_CONTRACT_ADDRESS` vide et compiler avec Forge.

```sh
pnpm deploy:monad --deployer ADRESSE_PUBLIQUE --max-cost 1
pnpm deploy:monad --deployer ADRESSE_PUBLIQUE --max-cost 1 --broadcast
```

La première commande vérifie compte, réseau, artefact et frais sans signer.
`--max-cost` borne les frais maximaux en MON ; sa valeur par défaut est `0.2`.
La version actuelle nécessitait un plafond supérieur, avec une estimation de
`0.314757648 MON` lors du déploiement, sous le plafond explicite de 1 MON.

La diffusion conserve d’abord la transaction signée dans le journal ignoré
`contracts/broadcast/monad-testnet.json`. Relancer la même commande reprend la
même transaction. Le script contrôle reçu, bytecode et relayer, puis met à jour
`.env` et le manifeste public. Ne pas supprimer un journal pour contourner un
échec. Le journal du premier déploiement a été conservé séparément dans
`contracts/broadcast/monad-testnet-v1.json`.

L’ABI compilée est dans `contracts/out/MonadSurf.sol/MonadSurf.json` (ignoré).
Voir [le contrat et les formats](../docs/backend-monad.md) et
[l’API et ses limites](../docs/backend-api.md). Les seules variables requises
pour l’application sont l’origine, le RPC, l’adresse et la clé privée du relayer.
