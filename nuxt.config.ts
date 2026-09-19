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
      title: 'Subway Frauder',
      htmlAttrs: {
        lang: 'fr',
      },
      meta: [
        {
          name: 'description',
          content: 'Subway Frauder : un runner contrôlé par tes mouvements, conçu pour Monad Blitz Paris.',
        },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
})
