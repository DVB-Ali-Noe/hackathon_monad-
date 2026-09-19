<script setup lang="ts">
const {
  video, phase, error, notice, landmarks, calibration, movement, calibrating, calibrationCountdown, visible,
  aspectRatio, inferenceMs, frameMs, analysisFps, detectedJumps, delegate, start, stop, beginCalibration,
} = usePoseCamera()

useHead({ title: 'Calibration caméra · Monad Blitz' })

const active = computed(() => phase.value !== 'idle')
const calibrated = computed(() => calibration.value.reference !== null)
const tracked = computed(() => calibrated.value && movement.value.tracking === 'tracked')
const input = computed(() => movement.value.input)
const status = computed(() => {
  if (phase.value === 'requesting') return 'Autorisation en attente'
  if (phase.value === 'loading') return 'Chargement de l’analyse'
  if (phase.value === 'idle') return 'Caméra éteinte'
  if (calibrationCountdown.value > 0) return 'Prépare-toi'
  if (calibrating.value && !visible.value) return 'En attente du cadrage'
  if (!visible.value) return calibrated.value ? 'Suivi perdu' : 'Corps hors cadre'
  if (calibrating.value) return 'Calibration en cours'
  if (!calibrated.value) return 'Prêt à calibrer'
  return tracked.value ? 'Suivi actif' : 'Suivi retrouvé · stabilisation'
})
const guidance = computed(() => {
  if (phase.value === 'idle') return 'Active ta caméra pour commencer.'
  if (phase.value === 'requesting') return 'Autorise l’accès à la caméra dans ton navigateur.'
  if (phase.value === 'loading') return 'Le modèle se charge. Le premier lancement peut prendre quelques instants.'
  if (calibrationCountdown.value > 0) return 'Recule et place-toi debout au centre, tête et pieds visibles.'
  if (!calibrated.value && !calibrating.value) return 'Clique sur « Calibrer ma position », puis recule. Tu as cinq secondes pour te placer.'
  if (calibrating.value && !visible.value) return 'La calibration attend ton cadrage. Recule pour montrer ta tête et tes pieds, puis reste immobile.'
  if (!visible.value) return 'Recule pour montrer ta tête et tes pieds. Éclaire-toi de face et reste seul dans le cadre.'
  if (calibrating.value) return calibration.value.hint
  if (!tracked.value) return 'Suivi retrouvé. Tiens-toi debout un instant avant de reprendre.'
  return 'Déplace-toi de côté, reviens au centre, saute puis accroupis-toi.'
})
const actionLabel = computed(() => {
  if (!tracked.value) return calibrated.value ? 'Suivi à retrouver' : 'En attente'
  return { none: 'Debout', jump: 'Saut', crouch: 'Accroupi' }[input.value.action]
})
const joints = computed(() => [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
  .flatMap(index => landmarks.value[index] ? [{ ...landmarks.value[index]!, index }] : []))
const connections = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 31], [28, 32]] as const
const segments = computed(() => connections.flatMap(([from, to]) => {
  const a = landmarks.value[from]
  const b = landmarks.value[to]
  return a && b ? [{ from, to, a, b }] : []
}))
const lanes = [{ value: -1, label: 'Gauche', arrow: '←' }, { value: 0, label: 'Centre', arrow: '•' }, { value: 1, label: 'Droite', arrow: '→' }]
</script>

<template>
  <main class="min-h-dvh bg-zinc-950 px-4 py-6 text-zinc-50 sm:px-8 sm:py-10">
    <div class="mx-auto max-w-6xl">
      <header class="flex items-center justify-between gap-4 border-b border-zinc-800 pb-6">
        <NuxtLink to="/" class="text-sm font-semibold tracking-wide text-violet-300 hover:text-violet-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300">
          <span aria-hidden="true">←</span> Monad Blitz
        </NuxtLink>
        <nav aria-label="Navigation principale" class="flex items-center gap-1 rounded-full bg-white/5 p-1 text-sm">
          <NuxtLink to="/jeu" class="rounded-full px-5 py-2 text-zinc-300 hover:bg-white/5">Jouer</NuxtLink>
          <NuxtLink to="/calibration" aria-current="page" class="rounded-full bg-violet-300 px-5 py-2 font-semibold text-violet-950">Calibration</NuxtLink>
        </nav>
      </header>

      <div class="mb-8 mt-8 sm:mt-10">
        <p class="text-xs font-semibold uppercase tracking-widest text-violet-400">01 / Caméra & calibration</p>
        <h1 class="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">Trouve tes repères.</h1>
        <p class="mt-4 max-w-2xl leading-relaxed text-zinc-400">Une courte calibration, puis cinq gestes à essayer. Garde de la place autour de toi et cadre ton corps en entier.</p>
      </div>

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-label="Aperçu de la caméra" class="min-w-0 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <div class="flex items-center justify-between gap-3 px-5 py-4 text-sm">
            <span class="flex items-center gap-2" role="status">
              <span class="size-2 rounded-full" :class="tracked ? 'bg-emerald-400' : active ? 'bg-amber-300' : 'bg-zinc-500'" aria-hidden="true" />
              {{ status }}
            </span>
            <span class="text-xs text-zinc-400">Aperçu miroir</span>
          </div>
          <div class="relative bg-zinc-950" :style="{ aspectRatio }">
            <video ref="video" autoplay playsinline muted aria-label="Aperçu miroir de ta webcam" class="absolute inset-0 size-full -scale-x-100 object-contain" :class="{ 'opacity-0': !active }" />
            <div v-if="active" class="pointer-events-none absolute inset-x-[30%] inset-y-[8%] rounded-[3rem] border border-dashed border-white/30" aria-hidden="true" />
            <svg v-if="landmarks.length" class="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line v-for="segment in segments" :key="`${segment.from}-${segment.to}`" :x1="(1 - segment.a.x) * 100" :y1="segment.a.y * 100" :x2="(1 - segment.b.x) * 100" :y2="segment.b.y * 100" stroke="#a78bfa" stroke-width="0.45" />
              <circle v-for="joint in joints" :key="joint.index" :cx="(1 - joint.x) * 100" :cy="joint.y * 100" r="0.65" fill="#d9f99d" />
            </svg>
            <div v-if="calibrationCountdown > 0" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/40 text-center" role="status" aria-atomic="true">
              <span class="text-8xl font-semibold tabular-nums text-white sm:text-9xl">{{ calibrationCountdown }}</span>
              <span class="rounded-full bg-zinc-950/80 px-4 py-2 text-lg font-medium text-white">Recule et place-toi</span>
            </div>
            <div v-if="!active" class="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
              <svg class="size-12 text-zinc-600" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="7" y="13" width="25" height="22" rx="5" /><path d="m32 21 9-6v18l-9-6" /></svg>
              <p class="max-w-xs text-sm leading-relaxed text-zinc-400">Ton aperçu apparaîtra ici après ton autorisation.</p>
            </div>
          </div>
          <div class="space-y-4 p-5">
            <p class="min-h-12 text-sm leading-relaxed text-zinc-300" role="status">{{ guidance }}</p>
            <div v-if="calibrating && calibrationCountdown === 0" class="space-y-2">
              <div class="flex justify-between text-xs text-violet-200"><span>Position stable</span><span>{{ Math.round(calibration.progress * 100) }} %</span></div>
              <progress class="h-2 w-full accent-violet-400" :value="calibration.progress" max="1" aria-label="Progression de la calibration" />
            </div>
            <p v-if="error" role="alert" class="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4 text-sm leading-relaxed text-rose-200">{{ error }}</p>
            <p v-if="notice" role="status" class="text-sm text-amber-200">{{ notice }}</p>
            <div class="flex flex-wrap gap-3">
              <button v-if="!active" type="button" class="rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-violet-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300" @click="start">{{ error ? 'Réessayer' : 'Activer la caméra' }}</button>
              <button v-if="phase === 'running'" type="button" :disabled="calibrating" class="rounded-xl bg-violet-400 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-violet-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-40" @click="beginCalibration">{{ calibrationCountdown > 0 ? 'Préparation…' : calibrated ? 'Recalibrer' : calibrating ? 'Calibration…' : 'Calibrer ma position' }}</button>
              <button v-if="active" type="button" class="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-medium transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300" @click="stop">{{ phase === 'requesting' ? 'Annuler' : 'Arrêter la caméra' }}</button>
            </div>
            <p class="text-xs leading-relaxed text-zinc-500">Les images restent sur cet appareil, sans envoi ni enregistrement. Le modèle est téléchargé au démarrage.</p>
          </div>
        </section>

        <div class="space-y-5">
          <section class="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6" aria-labelledby="command-title">
            <div class="flex items-center justify-between gap-3"><h2 id="command-title" class="font-semibold">Commande détectée</h2><span class="text-xs text-zinc-400">En direct</span></div>
            <div class="mt-5 grid grid-cols-3 gap-2" aria-label="Couloir détecté">
              <div v-for="lane in lanes" :key="lane.value" class="rounded-xl border px-2 py-4 text-center transition-colors" :class="tracked && input.lane === lane.value ? 'border-violet-400 bg-violet-400/15 text-violet-200' : 'border-zinc-800 text-zinc-500'" :aria-current="tracked && input.lane === lane.value ? 'true' : undefined">
                <span class="block text-2xl" aria-hidden="true">{{ lane.arrow }}</span><span class="mt-2 block text-sm">{{ lane.label }}</span>
              </div>
            </div>
            <div class="mt-4 rounded-xl border border-zinc-800 px-5 py-6" role="status">
              <p class="text-xs uppercase tracking-widest text-zinc-500">Posture</p>
              <p class="mt-2 text-3xl font-semibold" :class="tracked && input.action !== 'none' ? 'text-lime-300' : 'text-zinc-200'">{{ actionLabel }}</p>
              <p class="mt-3 text-sm text-zinc-400">Sauts détectés : <span class="font-semibold tabular-nums text-lime-300">{{ detectedJumps }}</span></p>
            </div>
            <p class="mt-4 text-xs leading-relaxed text-zinc-400">En cas de perte du suivi, les commandes reviennent au neutre. Reviens dans le cadre et stabilise-toi pour reprendre.</p>
          </section>

          <section class="rounded-2xl border border-zinc-800 p-5 sm:p-6" aria-labelledby="try-title">
            <h2 id="try-title" class="font-semibold">À toi de bouger</h2>
            <ol class="mt-5 space-y-4 text-sm leading-relaxed text-zinc-400">
              <li><span class="mr-3 font-mono text-violet-400">01</span>Clique sur « Calibrer ma position », recule pendant les cinq secondes, puis reste debout au centre sans bouger.</li>
              <li><span class="mr-3 font-mono text-violet-400">02</span>Fais un pas à gauche, marque brièvement le centre, puis va à droite. L’aperçu suit ton miroir.</li>
              <li><span class="mr-3 font-mono text-violet-400">03</span>Saute avec les deux pieds, puis accroupis-toi. Garde tes pieds visibles.</li>
              <li><span class="mr-3 font-mono text-violet-400">04</span>Sors du cadre et reviens pour vérifier la reprise du suivi.</li>
            </ol>
          </section>

          <details class="rounded-2xl border border-zinc-800 px-5 py-4 text-sm">
            <summary class="cursor-pointer text-zinc-400 focus-visible:outline-2 focus-visible:outline-violet-300">Mesures du diagnostic</summary>
            <dl class="mt-4 grid grid-cols-2 gap-y-3 text-xs"><dt class="text-zinc-500">Accélération</dt><dd class="text-right">{{ delegate || '—' }}</dd><dt class="text-zinc-500">Analyse</dt><dd class="text-right">{{ analysisFps }} images/s</dd><dt class="text-zinc-500">Inférence</dt><dd class="text-right">{{ inferenceMs }} ms</dd><dt class="text-zinc-500">Image → résultat</dt><dd class="text-right">{{ frameMs }} ms</dd></dl>
            <p class="mt-4 break-all font-mono text-xs text-violet-300">lane: {{ input.lane }} · action: {{ input.action }}</p>
            <p class="mt-3 text-xs leading-relaxed text-zinc-500">Analyse de la dernière image disponible, hors du fil d’affichage. GPU si disponible, sinon CPU. Le délai affiché commence à la réception de l’image par le navigateur ; il n’inclut pas tout le délai caméra → écran.</p>
          </details>
        </div>
      </div>
    </div>
  </main>
</template>
