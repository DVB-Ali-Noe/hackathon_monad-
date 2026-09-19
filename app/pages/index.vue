<template>
  <main class="flex min-h-dvh items-center bg-zinc-950 px-6 py-16 text-zinc-50 sm:px-12">
    <div class="mx-auto w-full max-w-5xl">
      <p class="text-sm font-semibold uppercase tracking-widest text-violet-400">
        Monad Blitz Paris
      </p>
      <h1 class="mt-8 max-w-3xl text-5xl font-semibold tracking-tight sm:text-7xl">
        Ton corps.<br>
        Ta manette.
      </h1>
      <p class="mt-6 max-w-lg text-lg leading-relaxed text-zinc-400">
        Saute, baisse-toi et esquive. Un runner qui se joue devant ta caméra.
      </p>
      <div class="mt-10 flex flex-wrap items-center gap-6">
        <NuxtLink to="/jeu" class="inline-flex items-center gap-4 rounded-xl bg-violet-300 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-violet-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300">
          Entrer sur la piste <span aria-hidden="true">↗</span>
        </NuxtLink>
        <NuxtLink to="/calibration" class="text-sm text-zinc-400 underline underline-offset-4 hover:text-violet-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300">Calibration et diagnostic</NuxtLink>
      </div>
      <p class="mt-5 text-sm text-zinc-500">Une course sans limite de temps et trois vies pour aller le plus loin possible.</p>
    </div>
  </main>
</template>
