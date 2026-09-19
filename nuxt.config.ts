import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-19',
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    databaseUrl: '',
    siteOrigin: '',
    monadRpcUrl: '',
    monadContractAddress: '',
    relayerPrivateKey: '',
    relaySecret: '',
  },
  nitro: {
    vercel: {
      functions: {
        runtime: 'nodejs24.x',
      },
    },
  },
  app: {
    head: {
      title: 'Monad Blitz',
      htmlAttrs: {
        lang: 'fr',
      },
      meta: [
        {
          name: 'description',
          content: 'Un runner contrôlé par tes mouvements, conçu pour Monad Blitz Paris.',
        },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
