# Référence Monad

Relevé des informations utiles au projet, vérifiées sur la documentation officielle
le 19 septembre 2026. La documentation en ligne fait foi en cas d'écart.

## 1. Réseaux

| | Testnet | Mainnet |
| --- | --- | --- |
| Chain ID | `10143` | `143` |
| Monnaie | MON | MON |
| RPC public | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| WebSocket | `wss://testnet-rpc.monad.xyz` | `wss://rpc.monad.xyz` |
| Faucet | https://faucet.monad.xyz | — |
| Explorateurs | testnet.monadvision.com, testnet.monadscan.com | monadvision.com, monadscan.com |

Le mainnet est en service depuis le 24 novembre 2025. Le projet cible le testnet.

`Multicall3` est déployé sur les deux réseaux à l'adresse standard
`0xcA11bde05977b3631167028862bE2a173976CA11`.

## 2. Performances

| Métrique | Valeur |
| --- | --- |
| Temps de bloc | 300 ms |
| Finalité spéculative | 300 ms, un slot |
| Finalité complète | 600 ms, deux slots |
| Gas par bloc | 150 M |
| Gas par transaction | 30 M |
| Débit de conception | plus de 10 000 tps |

Coût indicatif : un transfert natif de 21 000 gas revient à environ 0,00005 dollar,
une transaction de 200 000 gas à environ 0,0005 dollar au prix plancher.

## 3. Limites de débit des RPC publics

| Endpoint | Limite | Taille de batch |
| --- | --- | --- |
| `rpc.monad.xyz` | 25 req/s | 100 |
| `rpc1.monad.xyz` | 15 req/s | 100 |
| `rpc2.monad.xyz` | 300 par 10 s | 10 |

Une clé dédiée chez un fournisseur est nécessaire dès qu'une démonstration met
plusieurs joueurs en parallèle.

## 4. Différences avec Ethereum à connaître

**Le gas limit est facturé, pas le gas consommé.** Le montant prélevé est
`value + gas_price * gas_limit`. Surestimer coûte réellement. Pour les actions à
coût fixe, écrire la limite en dur plutôt qu'appeler `estimateGas`.

**Le storage est chauffé par page de 128 slots consécutifs**, pour 8 100 gas, contre
2 100 par slot sur Ethereum. Les tableaux contigus sont donc nettement moins chers
que les mappings à clés dispersées. `SSTORE` coûte 2 800 pour la première écriture
dans une page, puis 17 000 par nouveau slot.

**L'expansion mémoire est linéaire**, `w / 2` au lieu de `3w + w² / 512`, et plafonnée
à 8 Mo par transaction. Atteindre ce plafond coûte 131 072 gas ; le même calcul
dépasserait 135 millions de gas sur Ethereum.

**`TIMESTAMP` est à la seconde.** Trois à quatre blocs consécutifs partagent le même
horodatage. Toute logique temporelle doit s'appuyer sur `block.number`.

**Taille maximale d'un contrat : 128 Ko**, contre 24,5 Ko sur Ethereum.

**Exécution asynchrone.** Le consensus précède l'exécution, avec un décalage de trois
blocs. Un compte qui vient d'être approvisionné doit attendre environ 1,2 seconde
avant de pouvoir dépenser. Une réserve de 10 MON s'applique aux comptes délégués via
EIP-7702.

**Transactions supportées** : types 0, 1, 2 et 4. Le type 3, EIP-4844, ne l'est pas.

**Pas de mempool global.** Chaque validateur tient son propre mempool. Les
transactions en attente ne sont pas consultables par hash et la souscription
`newPendingTransactions` n'existe pas.

## 5. États de bloc et tags

| Tag | État Monad | Usage |
| --- | --- | --- |
| `latest` | Proposed | exécution spéculative, latence minimale, affichage |
| `safe` | Voted | supermajorité atteinte |
| `finalized` | Finalized | irréversible |

Les souscriptions WebSocket `monadNewHeads` et `monadLogs` fournissent un `blockId`
et un `commitState`, et signalent explicitement la progression d'un bloc plutôt que
de produire une réorganisation.

Avant finalisation, le numéro de bloc n'identifie pas un bloc de manière unique :
deux blocs candidats peuvent prétendre au même numéro. Le suivi d'une transaction à
travers les états doit utiliser le `blockId`.

## 6. Méthodes RPC utiles

`eth_sendRawTransactionSync` envoie une transaction et retourne son reçu en un seul
aller-retour, sans polling.

Pour des lectures multiples, un batch JSON-RPC est préférable à `Multicall3` :
`Multicall3` exécute les appels en série à l'intérieur d'un seul `eth_call`, alors
qu'un batch peut être traité en parallèle par le nœud. `viem` construit un batch
automatiquement à partir d'un `Promise.all`.

`eth_getTransactionCount` implique un aller-retour réseau ; suivre les nonces
localement lorsque plusieurs transactions se suivent de près.

## 7. Sources

- Documentation : https://docs.monad.xyz
- Index complet des pages : https://docs.monad.xyz/llms.txt
- Faits réseau à jour : https://docs.monad.xyz/ai/current-facts
- Tarification des opcodes : https://docs.monad.xyz/developer-essentials/opcode-pricing
- Bonnes pratiques : https://docs.monad.xyz/developer-essentials/best-practices
- Données temps réel spéculatives : https://docs.monad.xyz/monad-arch/realtime-data/spec-realtime
