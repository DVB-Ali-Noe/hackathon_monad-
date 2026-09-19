<script setup lang="ts">
import { nextLeaderboardRival, parseLeaderboard } from '~/utils/leaderboard'

definePageMeta({ alias: ['/'] })

const {
  camera, phase, mode, firstPerson, pseudo, state, result, countdown, pauseReason,
  rendererReady, rendererError, storageNotice, elapsedTime, cameraTracked, touch,
  advance, start, resume, pause, quit, onRendererError,
} = useRunner()
const { data: leaderboard, status: leaderboardStatus, refresh: refreshLeaderboard } = useFetch('/api/leaderboard', {
  server: false,
  lazy: true,
  timeout: 7000,
  retry: 0,
  transform: parseLeaderboard,
})
const rival = computed(() => nextLeaderboardRival(leaderboard.value?.entries ?? [], state.value.score))
watch(phase, (next, previous) => {
  if ((previous === 'setup' || previous === 'finished') && next !== 'setup') void refreshLeaderboard({ dedupe: 'defer' })
})
const {
  video, phase: cameraPhase, error: cameraError, calibration, calibrationCountdown,
  calibrating, visible, movement,
} = camera
const stage = ref<HTMLElement | null>(null)
const { fullscreen, fullscreenError, toggleFullscreen } = useGameFullscreen(stage, () => { if (phase.value === 'running') pause() })
const texturesLoaded = ref(true)
const playing = computed(() => phase.value !== 'setup' && phase.value !== 'finished')
const preparation = computed(() => {
  if (cameraPhase.value === 'requesting') return 'Autorise la caméra dans ton navigateur.'
  if (cameraPhase.value === 'loading') return 'Le suivi des mouvements se prépare…'
  if (calibrationCountdown.value > 0) return 'Recule pour montrer ton corps en entier.'
  if (!visible.value) return 'Place-toi au centre, les pieds et les épaules dans le cadre.'
  if (calibrating.value) return calibration.value.hint
  return 'Tiens-toi debout un instant. La course va démarrer.'
})
const pauseMessage = computed(() => ({
  manual: 'Prends ton temps. La piste t’attend.',
  tracking: 'Reviens dans le cadre. La course reprendra après le compte à rebours.',
  hidden: 'La course s’est arrêtée pendant ton absence.',
  slow: 'Une interruption a mis la course en pause. Tu peux reprendre.',
  renderer: 'Le rendu de la piste a été interrompu.',
}[pauseReason.value]))
const posture = computed(() => mode.value === 'keyboard' ? 'Clavier'
  : !cameraTracked.value ? 'Recherche du joueur'
    : { none: 'Debout', jump: 'Saut détecté', crouch: 'Accroupi' }[movement.value.input.action])

function press(event: PointerEvent, lane?: -1 | 1, action?: 'jump' | 'crouch') {
  if (phase.value !== 'running') return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  if (lane) touch.lane = lane
  if (action) touch.action = action
}

useHead({ title: 'Play · Subway Frauder' })
</script>

<template>
  <main class="runner-page min-h-dvh px-2 py-2 text-zinc-100 sm:px-3">
    <div class="w-full">
      <header class="mb-2 flex flex-wrap items-center justify-between gap-3 px-2">
        <NuxtLink to="/" class="text-xl font-black tracking-tight">Subway <span class="text-amber-300">Frauder</span></NuxtLink>
        <nav aria-label="Navigation principale" class="flex items-center gap-1 rounded-full bg-white/5 p-1 text-sm">
          <NuxtLink to="/jeu" aria-current="page" class="rounded-full bg-amber-300 px-5 py-2 font-semibold text-sky-950">Jouer</NuxtLink>
        </nav>
      </header>

      <div class="grid gap-4">
        <section aria-label="Course" class="min-w-0">
          <div ref="stage" class="runner-stage relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[#12354d]">
            <ClientOnly>
              <RunnerScene :advance="advance" @ready="rendererReady = true" @error="onRendererError" @textures="texturesLoaded = $event" />
              <template #fallback><div class="flex size-full items-center justify-center text-sm text-zinc-400">Préparation de la piste…</div></template>
            </ClientOnly>

            <div class="runner-hud pointer-events-none absolute inset-x-0 top-0 grid grid-cols-2 items-start gap-4 bg-linear-to-b from-[#12354d] to-transparent p-4 pb-12 sm:p-7 sm:pb-14" lang="en">
              <div class="min-w-0">
                <p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/80 sm:text-sm">Score</p>
                <p class="mt-1 break-all text-[clamp(2.5rem,7vw,6rem)] font-black leading-none tracking-tight tabular-nums">{{ state.score.toLocaleString('en-US') }}</p>
                <div class="mt-4 flex flex-wrap gap-x-5 gap-y-2 sm:gap-x-8">
                  <div><p class="text-xs text-sky-200/70">Coins</p><p class="mt-1 text-lg font-semibold tabular-nums text-amber-200"><span aria-hidden="true">◈ </span>{{ state.coins.toLocaleString('en-US') }}</p></div>
                  <div><p class="text-xs text-sky-200/70">Time</p><p class="mt-1 text-lg font-semibold tabular-nums">{{ elapsedTime }}</p></div>
                  <div><p class="text-xs text-sky-200/70">Lives</p><div class="mt-1 flex gap-1" role="img" :aria-label="`${state.lives} lives remaining`"><svg v-for="life in 3" :key="life" viewBox="0 0 24 24" fill="currentColor" class="size-6 sm:size-7" :class="life <= state.lives ? 'text-rose-400' : 'text-white/20'" aria-hidden="true"><path d="M12 21s-9-5.7-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.3-9 12-9 12Z" /></svg></div></div>
                </div>
              </div>
              <section aria-label="Leaderboard target" class="min-w-0 justify-self-end rounded-xl border border-white/15 bg-[#102e46]/85 p-3 text-right sm:min-w-56 sm:p-5">
                <template v-if="leaderboardStatus === 'success' && leaderboard">
                  <template v-if="rival">
                    <p class="text-[10px] font-semibold uppercase tracking-widest text-sky-200/80 sm:text-xs">Next to beat</p>
                    <p class="mt-2 max-w-48 break-words text-sm font-bold text-white sm:text-xl">{{ rival.pseudo || `Player ${rival.playerId.slice(0, 8)}` }}</p>
                    <p class="mt-2 break-all text-[clamp(1.5rem,4vw,3.5rem)] font-black leading-none tracking-tight tabular-nums text-amber-300">{{ rival.gap.toLocaleString('en-US') }}</p>
                    <p class="mt-2 text-xs text-sky-100/80">points to catch up</p>
                  </template>
                  <p v-else class="text-lg font-black text-amber-300 sm:text-3xl">Best score</p>
                </template>
                <p v-else class="max-w-48 text-xs text-sky-100/80">{{ leaderboardStatus === 'error' ? 'Leaderboard unavailable' : 'Loading leaderboard…' }}</p>
              </section>
            </div>

            <section v-if="phase === 'setup' && !rendererError" class="runner-setup absolute inset-x-4 bottom-24 rounded-2xl border border-white/15 bg-[#102e46]/90 p-5 shadow-xl backdrop-blur-sm sm:left-7 sm:right-auto sm:w-80 sm:p-6" aria-labelledby="start-title">
              <h1 id="start-title" class="text-2xl font-black tracking-tight">À toi de courir.</h1>
              <p class="mt-2 text-sm leading-relaxed text-sky-100/80">Ton corps pilote la course.</p>
              <label for="pseudo" class="mt-5 block text-sm text-zinc-200">Ton pseudo</label>
              <input id="pseudo" v-model="pseudo" maxlength="20" autocomplete="nickname" placeholder="Coureur" class="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 outline-none focus:border-amber-300">
              <button :disabled="!rendererReady || !!rendererError" class="runner-button mt-4 w-full" @click="start('camera')">{{ rendererReady ? 'Activer la caméra et jouer' : 'Préparation de la piste…' }}</button>
              <button :disabled="!rendererReady || !!rendererError" class="mt-2 w-full py-2 text-sm text-zinc-200 disabled:opacity-40" @click="start('keyboard')">Essayer au clavier ou au tactile</button>
              <p class="mt-2 text-xs leading-relaxed text-zinc-300">Cinq secondes pour reculer, puis le départ est automatique.</p>
            </section>

            <div v-if="phase === 'preparing' || phase === 'countdown'" class="absolute inset-0 flex flex-col items-center justify-center bg-[#12354d]/65 px-6 text-center backdrop-blur-[3px]" role="status">
              <template v-if="phase === 'countdown'">
                <p class="text-lg text-sky-200">À toi de jouer</p><p class="my-4 text-9xl font-black tabular-nums">{{ countdown }}</p><p class="text-sm text-zinc-300">Gauche, droite, saute, baisse-toi.</p>
              </template>
              <template v-else>
                <p class="text-lg font-semibold">{{ calibrationCountdown ? 'Prends ta place' : 'Trouvons tes repères' }}</p>
                <p v-if="calibrationCountdown" class="my-4 text-8xl font-black tabular-nums">{{ calibrationCountdown }}</p>
                <p class="mt-4 max-w-sm text-sm leading-relaxed text-zinc-300">{{ preparation }}</p>
                <progress v-if="calibrating && !calibrationCountdown" class="mt-6 h-2 w-56 accent-amber-300" :value="calibration.progress" max="1" aria-label="Calibration" />
                <p v-if="cameraError" role="alert" class="mt-5 max-w-md rounded-xl bg-rose-950/80 p-4 text-sm text-rose-200">{{ cameraError }}</p>
                <button v-if="cameraPhase === 'idle'" class="runner-button mt-5" @click="resume">Réactiver la caméra</button>
              </template>
              <button class="mt-7 text-sm text-zinc-400 underline decoration-zinc-600 underline-offset-4 hover:text-white" @click="quit">Retour à la préparation</button>
            </div>

            <div v-if="phase === 'paused' && !rendererError" class="absolute inset-0 flex flex-col items-center justify-center bg-[#12354d]/80 px-6 text-center backdrop-blur-sm" role="status">
              <p class="text-sm text-sky-200">La piste est en pause</p><h2 class="mt-3 text-4xl font-bold tracking-tight">{{ pauseReason === 'tracking' ? 'Retrouve ta position.' : 'On souffle.' }}</h2>
              <p class="mt-5 max-w-sm text-sm leading-relaxed text-zinc-300">{{ pauseMessage }}</p>
              <button v-if="pauseReason !== 'tracking' || cameraPhase === 'idle'" class="runner-button mt-7" @click="resume">{{ mode === 'camera' && cameraPhase === 'idle' ? 'Réactiver et reprendre' : 'Reprendre la course' }}</button>
              <button class="mt-5 text-sm text-zinc-400 underline underline-offset-4 hover:text-white" @click="quit">Quitter la course</button>
            </div>

            <div v-if="phase === 'finished' && result" class="absolute inset-0 flex flex-col items-center justify-center bg-[#12354d]/90 px-6 text-center backdrop-blur-sm" role="status">
              <p class="text-sm text-sky-200">{{ result.pseudo }} · Course terminée</p>
              <h2 class="mt-4 text-6xl font-black tabular-nums tracking-tight sm:text-8xl">{{ result.score.toLocaleString('fr-FR') }}</h2>
              <p class="mt-2 text-sm text-zinc-400">points · résultat local</p>
              <div class="mt-7 flex gap-8 text-sm"><span><strong class="text-xl text-amber-200">{{ result.coins }}</strong> pièces</span><span><strong class="text-xl">{{ Math.floor(state.distance / 1000) }}</strong> mètres</span></div>
              <div class="mt-8 flex flex-wrap justify-center gap-3">
                <button class="runner-button" @click="start(mode)">Nouvelle piste</button>
              </div>
              <button class="mt-5 text-sm text-zinc-400 underline underline-offset-4" @click="quit">Changer de joueur</button>
            </div>

            <div v-if="rendererError" class="absolute inset-0 flex items-center justify-center bg-[#12354d]/95 p-8 text-center"><p role="alert" class="max-w-md leading-relaxed text-rose-200">{{ rendererError }}</p></div>

          <section aria-label="Retour caméra" class="absolute bottom-28 left-4 z-10 w-44 rounded-xl bg-[#12354d]/90 p-2 sm:bottom-20 sm:w-72 lg:w-88" :class="{ hidden: cameraPhase === 'idle' }">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-1 text-xs"><span class="font-medium">Ta position</span><span class="text-xs" :class="cameraTracked ? 'text-emerald-300' : 'text-zinc-500'">{{ posture }}</span></div>
            <div class="relative aspect-4/3 overflow-hidden rounded-xl border border-white/10 bg-[#12354d]">
              <video ref="video" autoplay playsinline muted aria-label="Aperçu miroir de la caméra" class="absolute inset-0 size-full -scale-x-100 object-contain" :class="{ 'opacity-0': cameraPhase === 'idle' }" />
              <div v-if="cameraPhase !== 'idle'" class="pointer-events-none absolute inset-x-[30%] inset-y-[8%] rounded-3xl border border-dashed border-white/25" />
              <p v-else class="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">{{ mode === 'keyboard' && playing ? 'Mode clavier' : 'Caméra éteinte' }}</p>
            </div>
            <div v-if="cameraTracked" class="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]"><span v-for="(label, index) in ['Gauche', 'Centre', 'Droite']" :key="label" class="rounded-md py-1" :class="movement.input.lane === index - 1 ? 'bg-amber-300/20 text-sky-200' : 'text-zinc-600'">{{ label }}</span></div>
          </section>

            <div class="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-linear-to-t from-[#12354d]/95 to-transparent px-4 pb-3 pt-8 text-xs">
              <span class="text-zinc-200">{{ firstPerson ? 'Vue à la première personne' : 'Vue extérieure' }} · {{ state.lives }} / 3 vies</span>
              <div class="flex items-center gap-2">
                <button class="runner-control" :aria-pressed="firstPerson" @click="firstPerson = !firstPerson">{{ firstPerson ? 'Vue extérieure' : 'Vue FPV' }}</button>
                <button v-if="phase === 'running' || phase === 'countdown'" class="runner-control" @click="pause()">Pause</button>
                <button class="runner-control" :aria-pressed="fullscreen" @click="toggleFullscreen">{{ fullscreen ? 'Quitter le plein écran' : 'Plein écran' }}</button>
              </div>
            </div>
            <p v-if="fullscreenError" role="alert" class="absolute inset-x-4 top-24 z-20 rounded-lg bg-[#102e46]/95 p-3 text-center text-sm text-amber-200">{{ fullscreenError }}</p>
            <div v-if="mode === 'keyboard' && phase === 'running'" class="absolute inset-x-4 bottom-20 z-10 mx-auto grid max-w-sm grid-cols-4 gap-2 select-none sm:inset-x-auto sm:right-5 sm:w-80">
              <button class="runner-touch" aria-label="Couloir gauche" @pointerdown.prevent="press($event, -1)" @pointerup="touch.lane = 0" @pointercancel="touch.lane = 0" @lostpointercapture="touch.lane = 0">←</button>
              <button class="runner-touch" aria-label="Couloir droit" @pointerdown.prevent="press($event, 1)" @pointerup="touch.lane = 0" @pointercancel="touch.lane = 0" @lostpointercapture="touch.lane = 0">→</button>
              <button class="runner-touch" @pointerdown.prevent="press($event, undefined, 'jump')" @pointerup="touch.action = 'none'" @pointercancel="touch.action = 'none'" @lostpointercapture="touch.action = 'none'">Saut</button>
              <button class="runner-touch" @pointerdown.prevent="press($event, undefined, 'crouch')" @pointerup="touch.action = 'none'" @pointercancel="touch.action = 'none'" @lostpointercapture="touch.action = 'none'">Accroupi</button>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p class="text-xs text-zinc-500">{{ mode === 'keyboard' && playing ? '← → : se déplacer · relâcher : centre · espace : sauter · ↓ : s’accroupir' : 'La course se met en pause si la caméra perd ta position.' }}</p>
            <button v-if="phase === 'running' || phase === 'countdown'" class="rounded-lg border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5" @click="pause()">Pause <span class="ml-2 text-xs text-zinc-500">Échap</span></button>
          </div>

        </section>

        <aside class="grid content-start gap-4 px-2">


          <section class="border-t border-white/10 pt-5" aria-labelledby="obstacles-title">
            <h2 id="obstacles-title" class="text-sm font-semibold">Lis la piste</h2>
            <ul class="mt-4 grid gap-4 text-sm text-zinc-400 sm:grid-cols-3">
              <li class="flex items-center gap-4"><span class="obstacle-icon obstacle-train" aria-hidden="true" /><span><strong class="block font-medium text-zinc-200">Monte sur les trains</strong>Prends une rampe et saute de toit en toit. Évite de face les trains qui arrivent.</span></li>
              <li class="flex items-center gap-4"><span class="obstacle-icon obstacle-jump" aria-hidden="true" /><span><strong class="block font-medium text-zinc-200">Saute</strong>Passe au-dessus de la barre ou atterris sur son dessus.</span></li>
              <li class="flex items-center gap-4"><span class="obstacle-icon obstacle-crouch" aria-hidden="true" /><span><strong class="block font-medium text-zinc-200">Baisse-toi</strong>Reste sous le portique.</span></li>
            </ul>
          </section>
          <p v-if="!texturesLoaded" class="text-xs text-amber-200" role="status">Les textures détaillées n’ont pas chargé. Vérifie ta connexion puis recharge la page.</p>
          <p v-if="storageNotice" class="text-xs leading-relaxed text-amber-200" role="status">{{ storageNotice }}</p>
        </aside>
      </div>
    </div>
  </main>
</template>

<style scoped>
.runner-page { background: #102e46; }
.runner-hud, .runner-stage h1 { text-shadow: 0 2px 2px #163f58; }
.runner-stage h1 { font-family: 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif; text-shadow: 0 3px 0 #163f58, 0 5px 18px #163f5860; }
.runner-stage { height: calc(100dvh - 76px); min-height: 520px; }
.runner-stage:fullscreen { width: 100vw; height: 100dvh; min-height: 0; border: 0; border-radius: 0; }
.runner-control { border: 1px solid #ffffff45; border-radius: 0.6rem; background: #12354dcc; padding: 0.65rem 0.8rem; color: #fff; }
.runner-control:hover { background: #24536e; }
.runner-button { border-radius: 0.8rem; padding: 0.85rem 1.1rem; font-size: 0.875rem; font-weight: 650; transition: background 150ms; }
.runner-button { background: #ffcf45; color: #173d58; box-shadow: 0 3px 0 #b88420; }
.runner-button:hover { background: #ffe283; }
.runner-button:disabled { cursor: wait; opacity: 0.4; }
.runner-touch { touch-action: none; border: 1px solid #ffffff20; border-radius: 0.65rem; padding: 0.8rem 0.3rem; font-size: 0.8rem; color: #d8d1ed; background: #12354dcc; }
.runner-touch:active { background: #ffcf4530; }
.obstacle-icon { display: block; flex: 0 0 2.5rem; height: 2.5rem; position: relative; }
.obstacle-train::after { content: ''; position: absolute; inset: 0.1rem 0.3rem; border-radius: 0.5rem 0.5rem 0.15rem 0.15rem; border-bottom: 0.35rem solid #284d69; background: linear-gradient(#ffca3d 28%, #326b92 28% 56%, #ffca3d 56%); }
.obstacle-jump::after { content: ''; position: absolute; inset: 1.5rem 0 0.35rem; background: repeating-linear-gradient(125deg, #ed4b42 0 7px, #fff7db 7px 14px); border-radius: 0.1rem; }
.obstacle-crouch::after { content: ''; position: absolute; inset: 0.5rem 0.1rem 0.1rem; border: solid #ed4b42; border-width: 0.6rem 0.17rem 0; }
button:focus-visible, a:focus-visible { outline: 2px solid #ffcf45; outline-offset: 4px; }
@media (max-width: 639px) { .runner-stage { height: calc(100dvh - 72px); min-height: 560px; } .runner-stage:fullscreen { height: 100dvh; min-height: 0; } }
@media (max-height: 600px) { .runner-setup { bottom: 4.5rem; padding: 1rem; } .runner-setup > p { display: none; } .runner-setup label { margin-top: 0.75rem; } }
@media (max-height: 450px) { .runner-setup { bottom: 4rem; max-height: calc(100dvh - 9rem); overflow-y: auto; } }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
