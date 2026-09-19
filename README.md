# Monad Blitz Paris

Runner contrôlé par les mouvements du joueur devant une webcam, avec scores,
pièces et skins sur Monad. Le squelette Nuxt 4, Vue 3, TypeScript et Tailwind CSS 4
est en place ; le gameplay et l'intégration blockchain restent à développer.

Le déploiement automatique sur `main` est opérationnel et a été validé le
19 septembre 2026.

- [Idée du projet et MVP](PROJECT.md)
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

Le site est accessible sur http://localhost:3000.

## Vérification et build

```sh
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

## Prochaine étape

Prototyper la caméra et la calibration, puis vérifier les commandes gauche,
droite, saut et accroupissement. Le périmètre du jeu et les choix restant à
valider sont détaillés dans [PROJECT.md](PROJECT.md).
