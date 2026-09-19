# Documentation technique

Les décisions validées et le périmètre sont dans [PROJECT.md](../PROJECT.md).
Le [README racine](../README.md) décrit le développement et le déploiement.

## Spécifications

| Document | Contenu |
| --- | --- |
| [interface.md](interface.md) | Commandes, graine aléatoire, simulation partagée et rejeu |
| [backend-monad.md](backend-monad.md) | Profils, sessions, parties, replays et top 25 onchain |
| [backend-api.md](backend-api.md) | API implémentée, configuration du relayer sans base externe et tests |
| [movements-api.md](movements-api.md) | API temps réel de la branche `chain`, contrat distinct et consignes de raccordement du front |
| [monad-reference.md](monad-reference.md) | Références réseau Monad à consulter lors de l'implémentation |
| [demo-et-pitch.md](demo-et-pitch.md) | Organisation proposée de la démo et du pitch |

Le moteur partagé est implémenté à 60 ticks/s, version `runner-5-oncoming-60hz`.
Lire `backend-api.md` pour l’intégration actuelle et ses limites. Le fantôme a
été retiré du front après les décisions initiales listées ci-dessous.

## Décisions validées le 19 septembre 2026

- Pseudo et relayer côté serveur, sans wallet joueur.
- Validation par rejeu serveur et simulation déterministe à pas fixe.
- Parcours aléatoire à graine conservée, sans génération issue des blocs Monad.
- Fantôme du joueur précédent et du leader.
- Boutique optionnelle ; contrat unique, sans NFT ni token.
- Rendu three.js et trois couloirs en perspective.
- Monad testnet, chain ID 10143.

`docs/PROJECT.md`, `docs/AGENTS.md` et `docs/CLAUDE.md` renvoient aux documents racine
pour éviter des versions concurrentes. Les fichiers de consignes restent locaux
et ignorés par Git.
