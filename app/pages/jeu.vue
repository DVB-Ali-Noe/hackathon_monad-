<script setup lang="ts">
import type { LeaderboardEntry, LeaderboardSnapshot } from '#shared/api.ts'
import { nearestRival } from '#shared/leaderboard.ts'

definePageMeta({ alias: ['/'] })

const backend = useRunBackend()
const { playerId, leaderboard, leaderboardState, notice, submission, saving, saveError } = backend
const {
  camera, phase, mode, firstPerson, pseudo, state, result, countdown, pauseReason,
  rendererReady, rendererError, storageNotice, elapsedTime, cameraTracked, touch,
  advance, start, resume, pause, quit, onRendererError,
} = useRunner(backend.prepare)
const rival = computed(() => nearestRival(leaderboard.value?.entries || [], state.value.score, playerId.value))
const board = shallowRef<LeaderboardSnapshot | null>(null)
watch(leaderboard, (value) => { if (value) board.value = value }, { immediate: true })
const isMe = (entry: LeaderboardEntry) => !!playerId.value && entry.playerId.toLowerCase() === playerId.value.toLowerCase()
const playerName = (entry: LeaderboardEntry) => entry.pseudo || `Player ${entry.playerId.slice(0, 8)}`
const finalRows = computed(() => {
  const entries = board.value?.entries || []
  const rows = entries.filter(entry => !isMe(entry)).map(entry => ({ key: entry.playerId, name: playerName(entry), score: BigInt(entry.score), me: false, note: '' }))
  if (result.value) {
    const run = BigInt(result.value.score)
    const mine = entries.find(isMe)
    const best = mine && BigInt(mine.score) > run ? BigInt(mine.score) : run
    const status = submission.value?.status === 'confirmed' ? 'Confirmé sur Monad' : submission.value || saving.value ? 'En attente de confirmation' : 'Score local'
    const note = best > run ? `Meilleur score · cette course : ${run.toLocaleString('fr-FR')}` : status
    rows.splice(rows.filter(row => row.score >= best).length, 0, { key: 'me', name: result.value.pseudo, score: best, me: true, note })
  }
  const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }))
  const me = ranked.find(row => row.me)
  return !me || me.rank <= 5 ? ranked.slice(0, 5) : [...ranked.slice(0, 4), me]
})
const savedLabel = computed(() => saving.value ? 'Validation de la partie…'
  : ({ ready: 'Partie créée', submitted: 'Transaction envoyée · confirmation en cours', confirmed: 'Résultat confirmé sur Monad' }[submission.value?.status || 'ready']))
onMounted(() => { void backend.refreshLeaderboard() })
watch(result, (value) => { if (value) void backend.submit(value) })
async function changePlayer() {
  if (await backend.changePlayer()) { pseudo.value = ''; quit() }
}
const {
  video, phase: cameraPhase, error: cameraError, calibration, calibrationCountdown,
  calibrating, visible, movement,
} = camera
const { clip } = useHighlights(video, phase)
const muted = useState('music-muted', () => false)
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

            <div v-if="phase === 'setup' && !rendererError" class="absolute inset-0 overflow-hidden">
              <img src="/menu-bg.webp" alt="" fetchpriority="high" class="size-full object-cover object-top">
              <div class="absolute inset-0 bg-linear-to-b from-[#102e46]/60 via-transparent to-[#102e46]/90" />
              <div class="absolute left-4 top-5 z-10 sm:left-7 sm:top-7 lg:left-1/2 lg:top-[4%] lg:-translate-x-1/2 lg:text-center">
                <p class="runner-logo"><span>Subway</span><span class="text-[#ffcf45]">Frauder</span></p>
                <p class="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest sm:text-xs lg:justify-center">
                  <span class="-rotate-2 rounded-md bg-[#00a88f] px-2.5 py-1 text-white shadow-[0_3px_0_#0b2235]">Paris</span>
                  <span class="rotate-1 rounded-md bg-[#836ef9] px-2.5 py-1 text-white shadow-[0_3px_0_#0b2235]">on Monad</span>
                </p>
              </div>
              <button :disabled="!rendererReady" class="runner-press absolute bottom-[15%] left-1/2 hidden -translate-x-1/2 motion-safe:animate-pulse lg:block" @click="start('camera')">Bouge pour jouer</button>
            </div>

            <div class="runner-hud pointer-events-none absolute inset-x-0 top-0 grid grid-cols-2 items-start gap-4 bg-linear-to-b from-[#12354d] to-transparent p-4 pb-12 sm:p-7 sm:pb-14" lang="en">
              <div class="min-w-0" :class="{ invisible: phase === 'setup' }">
                <p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/80 sm:text-sm">Score</p>
                <p class="mt-1 break-all text-[clamp(2.5rem,7vw,6rem)] font-black leading-none tracking-tight tabular-nums">{{ state.score.toLocaleString('en-US') }}</p>
                <div class="mt-4 flex flex-wrap gap-x-5 gap-y-2 sm:gap-x-8">
                  <div><p class="text-xs text-sky-200/70">Coins</p><p class="mt-1 text-lg font-semibold tabular-nums text-amber-200"><span aria-hidden="true">◈ </span>{{ state.coins.toLocaleString('en-US') }}</p></div>
                  <div><p class="text-xs text-sky-200/70">Time</p><p class="mt-1 text-lg font-semibold tabular-nums">{{ elapsedTime }}</p></div>
                  <div><p class="text-xs text-sky-200/70">Lives</p><div class="mt-1 flex gap-1" role="img" :aria-label="`${state.lives} lives remaining`"><svg v-for="life in 3" :key="life" viewBox="0 0 24 24" fill="currentColor" class="size-6 sm:size-7" :class="life <= state.lives ? 'text-rose-400' : 'text-white/20'" aria-hidden="true"><path d="M12 21s-9-5.7-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.3-9 12-9 12Z" /></svg></div></div>
                </div>
              </div>
              <section aria-label="Leaderboard target" class="min-w-0 justify-self-end rounded-xl border border-white/15 bg-[#102e46]/85 p-3 text-right sm:min-w-56 sm:p-5">
                <template v-if="phase === 'setup' && board">
                  <p class="text-[10px] font-semibold uppercase tracking-widest text-sky-200/80 sm:text-xs">Top 5 · Leaderboard</p>
                  <ol v-if="board.entries.length" class="mt-3 grid gap-1.5 text-left text-xs sm:w-64 sm:text-sm">
                    <li v-for="(entry, index) in board.entries.slice(0, 5)" :key="entry.playerId" class="flex items-center gap-2 rounded-md px-1.5 py-0.5" :class="{ 'bg-amber-300/15': isMe(entry) }">
                      <span class="w-4 font-black tabular-nums" :class="index < 3 ? 'text-amber-300' : 'text-sky-200/70'">{{ index + 1 }}</span>
                      <span class="min-w-0 flex-1 truncate font-semibold text-white">{{ playerName(entry) }}</span>
                      <strong class="tabular-nums text-amber-200">{{ BigInt(entry.score).toLocaleString('en-US') }}</strong>
                    </li>
                  </ol>
                  <p v-else lang="fr" class="mt-2 max-w-48 text-xs text-sky-100/80">Le premier record reste à établir.</p>
                </template>
                <template v-else-if="leaderboardState === 'ready' && leaderboard">
                  <template v-if="rival">
                    <p class="text-[10px] font-semibold uppercase tracking-widest text-sky-200/80 sm:text-xs">Next to beat</p>
                    <p class="mt-2 max-w-48 break-words text-sm font-bold text-white sm:text-xl">{{ rival.pseudo || `Player ${rival.playerId.slice(0, 8)}` }}</p>
                    <p class="mt-2 break-all text-[clamp(1.5rem,4vw,3.5rem)] font-black leading-none tracking-tight tabular-nums text-amber-300">{{ BigInt(rival.gap).toLocaleString('en-US') }}</p>
                    <p class="mt-2 text-xs text-sky-100/80">points to catch up</p>
                  </template>
                  <p v-else class="text-lg font-black text-amber-300 sm:text-3xl">Best score</p>
                </template>
                <p v-else class="max-w-48 text-xs text-sky-100/80">{{ leaderboardState === 'unavailable' ? 'Leaderboard unavailable' : 'Loading leaderboard…' }}</p>
                <p v-if="notice" lang="fr" class="mt-2 max-w-48 text-xs text-amber-200">Mode local · score non enregistré</p>
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

            <div v-if="phase === 'connecting' || phase === 'preparing' || phase === 'countdown'" class="absolute inset-0 flex flex-col items-center justify-center bg-[#12354d]/65 px-6 text-center backdrop-blur-[3px]" role="status">
              <p v-if="phase === 'connecting'" class="text-lg font-semibold">Préparation de ta partie et du classement…</p>
              <template v-else-if="phase === 'countdown'">
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

            <div v-if="phase === 'finished' && result" class="absolute inset-0 z-20 bg-[#102e46]">
              <img src="/menu-bg.webp" alt="" class="absolute inset-0 size-full object-cover object-top">
              <div class="absolute inset-0 bg-linear-to-b from-[#0b2235]/75 via-[#0b2235]/35 to-[#0b2235]/85" />
              <div class="absolute inset-0 overflow-y-auto">
                <div class="mx-auto flex min-h-full w-full max-w-[110rem] flex-col gap-5 px-4 pb-20 pt-5 sm:px-8 lg:gap-[3.5vh] lg:pt-[3vh]">
                  <h2 class="runner-title text-center">Course terminée</h2>
                  <div class="grid gap-5 lg:items-start" :class="clip ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.15fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1.3fr)]'">
                    <div class="runner-card" role="status">
                      <div class="p-5 sm:p-7">
                        <p class="text-sm font-black uppercase tracking-wider text-sky-200">Ton score <span class="font-semibold normal-case tracking-normal text-sky-200/70">· {{ result.pseudo }}</span></p>
                        <p class="mt-2 break-all text-[clamp(3.5rem,6.5vw,6.5rem)] font-black leading-none tracking-tight tabular-nums">{{ result.score.toLocaleString('fr-FR') }}</p>
                        <p class="mt-1 text-sm font-black uppercase tracking-wider text-sky-200">Points</p>
                        <p class="mx-auto mt-4 flex w-fit items-center gap-2 rounded-full border-2 px-4 py-1.5 text-sm font-semibold" :class="submission?.status === 'confirmed' ? 'border-emerald-400 text-emerald-300' : 'border-[#ffcf45] text-amber-200'">
                          <svg viewBox="0 0 24 24" fill="currentColor" class="size-4 shrink-0" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
                          {{ submission || saving ? savedLabel : 'Résultat local' }}
                        </p>
                        <p v-if="notice" class="mt-3 text-center text-xs text-amber-200">{{ notice }}</p>
                        <p v-if="saveError" class="mt-3 text-center text-sm text-amber-200">{{ saveError }}</p>
                        <button v-if="saveError && !result.runId.startsWith('local-')" :disabled="saving" class="mx-auto mt-2 block text-sm underline" @click="backend.retry">Réessayer l’enregistrement</button>
                        <a v-if="submission?.transactionHash" :href="`https://testnet.monadvision.com/tx/${submission.transactionHash}`" target="_blank" rel="noopener noreferrer" class="mx-auto mt-2 block w-fit text-xs text-sky-200 underline">Voir la transaction sur Monad</a>
                        <div class="mt-5 grid grid-cols-2 gap-3">
                          <p class="runner-tile"><svg viewBox="0 0 24 24" class="size-9 shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ffcf45" /><circle cx="12" cy="12" r="6" fill="none" stroke="#b88420" stroke-width="2" /></svg><span><strong class="block text-2xl font-black leading-none tabular-nums">{{ result.coins }}</strong><span class="text-sm text-sky-100/80">pièces</span></span></p>
                          <p class="runner-tile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="size-9 shrink-0 text-sky-300" aria-hidden="true"><circle cx="15" cy="4.5" r="1.8" fill="currentColor" /><path d="m7 10 4-2.5 3 1.5 1.5 3.5 3 1M11 7.5 9.5 13l3.5 2.5-1 5M9.5 13 7 16H4" /></svg><span><strong class="block text-2xl font-black leading-none tabular-nums">{{ Math.floor(state.distance / 1000) }}</strong><span class="text-sm text-sky-100/80">mètres</span></span></p>
                        </div>
                        <button class="runner-button runner-replay mt-5 flex w-full items-center justify-center gap-3 uppercase tracking-wide" @click="start(mode)">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" class="size-7" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4M4 4v4h4M4 13a8 8 0 0 0 14.3 4M20 20v-4h-4" /></svg>
                          Rejouer
                        </button>
                        <button class="mt-3 w-full rounded-xl border-2 border-sky-200/70 py-3 text-sm font-black uppercase tracking-wider text-sky-100 hover:bg-white/10" @click="changePlayer">Changer de joueur</button>
                      </div>
                    </div>

                    <section v-if="clip" class="runner-card" aria-labelledby="highlights-title">
                      <div class="p-3 sm:p-4">
                        <h3 id="highlights-title" class="flex items-center gap-2 text-lg font-black uppercase tracking-tight sm:text-xl"><span class="size-2.5 rounded-full bg-rose-400 motion-safe:animate-pulse" aria-hidden="true" />Highlights</h3>
                        <video :src="clip" autoplay loop muted playsinline aria-label="Tes meilleurs moments de la course" class="mt-3 aspect-4/3 w-full -scale-x-100 rounded-xl border border-white/10 bg-[#0b2235] object-cover" />
                        <p class="mt-2 text-xs text-sky-100/70">Tes dernières secondes de course · vidéo locale, jamais envoyée.</p>
                      </div>
                    </section>

                    <section class="runner-card lg:col-start-3" aria-labelledby="final-board-title">
                      <div class="p-4 sm:p-6">
                        <h3 id="final-board-title" class="flex items-center gap-3 text-2xl font-black uppercase tracking-tight sm:text-3xl">
                          <svg viewBox="0 0 24 24" fill="currentColor" class="size-9 shrink-0 text-[#ffcf45]" aria-hidden="true"><path d="M6 3h12v2h3v3a4 4 0 0 1-4 4h-.3A6 6 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A6 6 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h3V3Zm0 4H5v1a2 2 0 0 0 1.2 1.8A6 6 0 0 1 6 8V7Zm12 0v1c0 .6-.1 1.2-.2 1.8A2 2 0 0 0 19 8V7h-1Z" /></svg>
                          <span>Classement <span class="text-[#ffcf45]">Top 5</span></span>
                        </h3>
                        <p v-if="!board" class="mt-4 text-sm text-zinc-300">{{ leaderboardState === 'unavailable' ? 'Classement indisponible pour le moment.' : 'Chargement du classement…' }}</p>
                        <template v-else>
                          <p class="mt-4 grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-3 px-4 text-xs font-black uppercase tracking-wider text-sky-300" aria-hidden="true"><span>Rang</span><span>Joueur</span><span>Score</span></p>
                          <ol class="mt-2 grid gap-1.5">
                            <li v-for="row in finalRows" :key="row.key" class="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-4 py-2" :class="row.me ? 'border-2 border-[#ffcf45] bg-[#ffcf45]/10' : 'border-white/10 bg-white/[0.03]'">
                              <span v-if="row.rank <= 3" class="runner-medal" :class="['runner-gold', 'runner-silver', 'runner-bronze'][row.rank - 1]">{{ row.rank }}</span>
                              <span v-else class="pl-2.5 text-lg font-black tabular-nums" :class="row.me ? 'text-white' : 'text-sky-300'">{{ row.rank > 25 ? '25+' : row.rank }}</span>
                              <span class="min-w-0">
                                <span class="block truncate text-base font-semibold sm:text-lg" :class="{ 'font-black text-[#ffcf45]': row.me }">{{ row.name }}</span>
                                <span v-if="row.me" class="block truncate text-xs text-sky-100/80">{{ row.note }}</span>
                              </span>
                              <strong class="text-base font-black tabular-nums sm:text-lg" :class="{ 'text-[#ffcf45]': row.me }">{{ row.score.toLocaleString('fr-FR') }}</strong>
                            </li>
                          </ol>
                          <p class="mt-4 flex items-center gap-3 text-xs text-sky-100/70"><span class="h-px flex-1 bg-white/15" />{{ leaderboardState === 'loading' ? 'Mise à jour…' : submission?.status === 'confirmed' ? 'Actualisé après confirmation' : 'Classement avant ta course' }} · bloc {{ BigInt(board.blockNumber).toLocaleString('fr-FR') }}<span class="h-px flex-1 bg-white/15" /></p>
                        </template>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
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

            <div class="absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-between gap-2 bg-linear-to-t from-[#12354d]/95 to-transparent px-4 pb-3 pt-8 text-xs">
              <span class="text-zinc-200">{{ firstPerson ? 'Vue à la première personne' : 'Vue extérieure' }} · {{ state.lives }} / 3 vies</span>
              <div class="flex items-center gap-2">
                <button class="runner-control" :aria-pressed="firstPerson" @click="firstPerson = !firstPerson">{{ firstPerson ? 'Vue extérieure' : 'Vue FPV' }}</button>
                <button v-if="phase === 'running' || phase === 'countdown'" class="runner-control" @click="pause()">Pause</button>
                <button class="runner-control" :aria-pressed="muted" @click="muted = !muted">{{ muted ? 'Activer le son' : 'Couper le son' }}</button>
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

          <section v-if="leaderboardState === 'ready' && leaderboard" class="mt-4 rounded-2xl border border-white/10 bg-[#102e46] p-4 sm:p-6" aria-labelledby="leaderboard-title">
            <h2 id="leaderboard-title" class="font-semibold">Top 25 historique <span class="text-xs font-normal text-sky-200">{{ submission?.status === 'confirmed' ? '· actualisé après confirmation' : '· chargé avant la course' }}</span></h2>
            <p v-if="!leaderboard.entries.length" class="mt-3 text-sm text-zinc-300">Le premier record reste à établir.</p>
            <ol v-else class="mt-3 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              <li v-for="(entry, index) in leaderboard.entries" :key="entry.playerId" class="flex items-center gap-3 border-t border-white/5 py-2 text-sm">
                <span class="w-6 text-zinc-400">{{ index + 1 }}</span><span class="min-w-0 flex-1 truncate">{{ entry.pseudo || `${entry.playerId.slice(0, 8)}…` }}</span><strong class="tabular-nums text-amber-200">{{ BigInt(entry.score).toLocaleString('fr-FR') }}</strong>
              </li>
            </ol>
          </section>
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
.runner-logo, .runner-press, .runner-title { font-family: 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif; font-style: italic; font-weight: 900; text-transform: uppercase; paint-order: stroke fill; }
.runner-logo { display: flex; flex-direction: column; transform: rotate(-3deg); font-size: clamp(2rem, 5vw, 4.5rem); line-height: 0.9; letter-spacing: -0.02em; white-space: nowrap; -webkit-text-stroke: 0.16em #0b2235; text-shadow: 0 0.09em 0 #0b2235; }
@media (min-width: 1024px) { .runner-logo { flex-direction: row; justify-content: center; gap: 0.28em; transform: rotate(-2deg); } }
.runner-press { font-size: clamp(1.5rem, 2.6vw, 2.5rem); letter-spacing: 0.04em; white-space: nowrap; color: #fff; -webkit-text-stroke: 0.2em #0b2235; text-shadow: 0 0.1em 0 #0b2235; }
.runner-title { font-size: clamp(1.75rem, 4.4vw, 4.25rem); line-height: 1; color: #fff; -webkit-text-stroke: 0.16em #0b2235; text-shadow: 0 0.09em 0 #0b2235; }
.runner-card { border-radius: 1.6rem; padding: 3px; background: linear-gradient(135deg, #ffcf45 0 8%, #ffffff2e 8% 92%, #ffcf45 92%); box-shadow: 0 18px 40px #06162499; }
.runner-card > div { height: 100%; border-radius: calc(1.6rem - 3px); background: #102e46f5; }
.runner-tile { display: flex; align-items: center; gap: 0.75rem; border: 1px solid #ffffff1f; border-radius: 1rem; background: #ffffff0a; padding: 0.8rem 1rem; }
.runner-medal { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border-radius: 9999px; font-weight: 900; color: #0b2235; box-shadow: inset 0 0 0 3px #ffffff59, 0 3px 0 #0b2235; }
.runner-gold { background: linear-gradient(160deg, #ffe58a, #e0a021); }
.runner-silver { background: linear-gradient(160deg, #f4f7fb, #97a4b5); }
.runner-bronze { background: linear-gradient(160deg, #f0b07a, #a65c27); }
.runner-press:hover { color: #ffcf45; }
.runner-press:disabled { cursor: wait; opacity: 0.5; }
.runner-control { border: 1px solid #ffffff45; border-radius: 0.6rem; background: #12354dcc; padding: 0.65rem 0.8rem; color: #fff; }
.runner-control:hover { background: #24536e; }
.runner-button { border-radius: 0.8rem; padding: 0.85rem 1.1rem; font-size: 0.875rem; font-weight: 650; transition: background 150ms; }
.runner-button { background: #ffcf45; color: #173d58; box-shadow: 0 3px 0 #b88420; }
.runner-button:hover { background: #ffe283; }
.runner-replay { padding-block: 1rem; font-size: 1.25rem; font-weight: 900; }
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
