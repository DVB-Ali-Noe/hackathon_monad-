# Monad Blitz Paris

Squelette Nuxt 4, Vue 3, TypeScript et Tailwind CSS 4.

- [Idée du projet et MVP](PROJECT.md)
- [Consignes de travail pour Claude](CLAUDE.md)

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

## Vercel

Le workflow [Deploy production](.github/workflows/deploy.yml) déploie le site sur
Vercel à chaque push ou fusion vers `main`. Il peut aussi être lancé depuis
**Actions → Deploy production → Run workflow**, en sélectionnant `main`.

Il installe les dépendances avec pnpm, vérifie TypeScript, puis envoie le code à
Vercel avec `vercel deploy --prod --yes`. Vercel construit l'application avec pnpm
et ses variables de production avant de la publier. Un échec d'installation, de
vérification ou de build bloque la mise en production. Les déploiements en cours
ne sont pas interrompus par les nouveaux pushs.

Le build distant permet d'utiliser un token limité au projet : `vercel pull`
exige également un accès à l'équipe avec cette version du CLI.

### Configuration initiale

Le projet Vercel existant est
[hackathon-monad-subway-surfer](https://vercel.com/byezzaali-gmailcoms-projects/hackathon-monad-subway-surfer).
Le site est accessible sur [hackathon-monad-brown.vercel.app](https://hackathon-monad-brown.vercel.app).

1. Réutiliser ce projet avec le preset **Nuxt**, le dossier racine `./` et Node.js
   24. Le fichier `vercel.json` définit le framework.
2. Renseigner les secrets du dépôt GitHub dans **Settings → Secrets and variables
   → Actions → New repository secret** :

   | Secret | Valeur |
   | --- | --- |
   | `VERCEL_TOKEN` | Un token Vercel autorisé à déployer ce projet |
   | `VERCEL_ORG_ID` | L'identifiant de l'équipe Vercel propriétaire du projet |
   | `VERCEL_PROJECT_ID` | L'identifiant du projet Vercel |

   Les deux identifiants se trouvent dans `.vercel/project.json` après la liaison
   locale au projet. Ce fichier est ignoré par Git. Ne pas placer le token dans
   le code ou dans un document partagé.
3. Publier le workflow et les fichiers de l'application sur `main`, puis vérifier
   son exécution dans l'onglet **Actions** de GitHub.

Les déploiements Git natifs de Vercel sont désactivés dans `vercel.json` pour que
GitHub Actions contrôle la mise en production après les vérifications.

Les variables d'environnement de l'application se configurent dans Vercel. Les
fichiers `.env` locaux sont ignorés par Git.
