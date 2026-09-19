# Monad Blitz Paris

Runner contrôlé par les mouvements du joueur devant une webcam, avec scores sur
Monad testnet. Le MVP prévoit un pseudo et un relayer serveur, un parcours aléatoire
à graine, une validation par rejeu, un rendu three.js et un fantôme. La boutique de
skins est optionnelle, sans NFT ni token.

Le runner, la caméra, le contrat et l’API sont intégrés sur `dev`. Les sessions,
le rejeu serveur, le relayer et le top 25 sont implémentés. `MonadSurf` est
[déployé et vérifié sur Monad testnet](contracts/README.md#contrat-déployé).
PostgreSQL et le worker relayer fonctionnent dans l’environnement local de `dev`.
Les services hébergés et leurs variables restent à configurer avant publication.

Le déploiement automatique sur `main` est opérationnel et a été validé le
19 septembre 2026.

- [Décisions produit et MVP](PROJECT.md)
- [Documentation technique](docs/README.md)
- `AGENTS.md` : consignes locales pour Codex et les agents, fichier ignoré par Git.
- `CLAUDE.md` : consignes locales pour Claude, fichier ignoré par Git.
- [Site de production](https://hackathon-monad-brown.vercel.app)
- [Exécution validée de la pipeline](https://github.com/DVB-Ali-Noe/hackathon_monad-/actions/runs/35436466316)

## Développement

Utiliser Node.js 24 (voir `.nvmrc`) et pnpm 10.34.5 (défini dans `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Le site est accessible sur http://localhost:3000. Sans configuration backend,
le jeu annonce explicitement une partie locale, sans crédit sur Monad.

Pour l’enregistrement : copier `.env.example` vers `.env`, renseigner PostgreSQL,
l’origine du site, le RPC, l’adresse du contrat et la clé relayer privée, puis lancer
`pnpm db:migrate`. Démarrer `pnpm relay` dans un worker pour poursuivre les envois
après fermeture du navigateur. Voir [l’installation et l’API](docs/backend-api.md).

Pour PostgreSQL local, renseigner un mot de passe aléatoire dans
`MONAD_POSTGRES_PASSWORD` et le même dans `NUXT_DATABASE_URL`, puis lancer
`docker compose up -d --wait` avant la migration. Le service écoute uniquement sur
`127.0.0.1:55432` et conserve ses données dans un volume Docker. Ne pas écraser un
`.env` existant. L’origine configurée doit correspondre exactement à celle utilisée
dans le navigateur.

Le classement se charge à l’ouverture et au début de chaque partie, puis se
rafraîchit après confirmation du résultat. Le panneau « Next to beat » utilise
ces données et exclut le joueur courant ; l’écart diminue localement.

## Vérification et build

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm preview
```

## Déploiement automatique

Le workflow [Deploy production](.github/workflows/deploy.yml) déploie le site sur
Vercel à chaque push ou fusion vers `main`. Il peut aussi être lancé depuis
**Actions → Deploy production → Run workflow**, en sélectionnant `main`.

Il installe les dépendances avec pnpm, vérifie TypeScript, puis envoie le code à
Vercel avec `vercel deploy --prod --yes`. Vercel construit l'application avec pnpm
et ses variables de production avant de la publier. Un échec d'installation, de
vérification ou de build bloque la mise en production. Les déploiements en cours
ne sont pas interrompus par les nouveaux pushs.

Le CLI Vercel est fixé à la version `59.10.0` dans le workflow. Le build distant
permet d'utiliser le token actuel, limité au projet : `vercel pull` exige
également un accès à l'équipe avec cette version du CLI.

### Configuration en place

Le projet Vercel existant est
[hackathon-monad-subway-surfer](https://vercel.com/byezzaali-gmailcoms-projects/hackathon-monad-subway-surfer).
Le site est accessible sur [hackathon-monad-brown.vercel.app](https://hackathon-monad-brown.vercel.app).

- Branche de production : `main`.
- Framework : **Nuxt**, dossier racine `./`, Node.js 24.
- Installation sur Vercel : `pnpm install --frozen-lockfile`.
- Build sur Vercel : `pnpm build`.
- Secrets GitHub Actions : les trois secrets ci-dessous sont déjà configurés.

| Secret | Rôle |
| --- | --- |
| `VERCEL_TOKEN` | Autorise GitHub Actions à déployer ce projet |
| `VERCEL_ORG_ID` | Identifie l'équipe Vercel propriétaire du projet |
| `VERCEL_PROJECT_ID` | Identifie le projet Vercel |

Pour renouveler un secret, utiliser les
[secrets Actions du dépôt](https://github.com/DVB-Ali-Noe/hackathon_monad-/settings/secrets/actions).
Les deux identifiants se trouvent également dans `.vercel/project.json` après
la liaison locale au projet. Ce fichier est ignoré par Git. Ne pas placer le
token dans le code ou dans un document partagé.

Les déploiements Git natifs de Vercel sont désactivés dans `vercel.json` pour que
GitHub Actions contrôle la mise en production après les vérifications.

Les variables d'environnement de l'application se configurent dans Vercel. Les
fichiers `.env` locaux sont ignorés par Git.

### Vérifier une publication

1. Après un push sur `main`, ouvrir
   [GitHub Actions](https://github.com/DVB-Ali-Noe/hackathon_monad-/actions/workflows/deploy.yml).
2. Attendre la réussite du workflow **Deploy production**, notamment de l'étape
   **Build and deploy production**.
3. Vérifier le résultat sur le site de production. Le résumé du workflow contient
   aussi l'URL propre au déploiement.

La connexion locale avec `vercel login` n'authentifie pas GitHub Actions : le
workflow utilise `VERCEL_TOKEN`. Si l'ancien message « Could not retrieve Project
Settings » réapparaît après une modification du workflow, vérifier qu'il utilise
toujours le build distant et ne réintroduit pas `vercel pull` avec ce token.

## Validation de l’intégration

Les tests Solidity se lancent avec Forge depuis `contracts/` ; voir
[contracts/README.md](contracts/README.md). Après compilation du contrat et
`pnpm build`, `pnpm test:integration` vérifie le circuit HTTP → PostgreSQL → Anvil.
Docker et Anvil sont nécessaires ; les services de test sont éphémères.

Les essais webcam et WebGL réels restent décrits dans [app/runner.md](app/runner.md).
