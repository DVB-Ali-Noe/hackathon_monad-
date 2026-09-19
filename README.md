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

Importer le dépôt GitHub dans Vercel avec le preset **Nuxt**, le dossier racine
`./` et les paramètres de build automatiques. Node.js 24 est défini dans
`package.json`. Le fichier `pnpm-lock.yaml` permet à Vercel de détecter pnpm.

Dans **Settings → Environments → Production → Branch Tracking**, sélectionner
`main`. Chaque push ou fusion vers `main` déclenchera alors un déploiement de
production via l'intégration GitHub de Vercel.

Les variables d'environnement se configurent dans Vercel. Les fichiers `.env`
locaux sont ignorés par Git.
