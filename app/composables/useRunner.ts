import type { GameInput, RunConfig, RunResult } from '../../shared/types'
import type { PreparedRun } from '../../shared/api'
import { createCourse, updateCourse, createState, stepGame, SIMULATION_VERSION, TICK_RATE } from '#shared/game/engine.ts'
import type { GameState, TrackItem } from '#shared/game/engine.ts'

export type RunnerFrame = {
  state: GameState
  previous: GameState
  alpha: number
  course: readonly TrackItem[]
  firstPerson: boolean
}

export function useRunner(prepareRun?: (pseudo: string) => Promise<PreparedRun | null>) {
  const camera = usePoseCamera()
  const phase = ref<'setup' | 'connecting' | 'preparing' | 'countdown' | 'running' | 'paused' | 'finished'>('setup')
  const mode = ref<'camera' | 'keyboard'>('camera')
  const firstPerson = ref(true)
  const pseudo = ref('')
  const state = shallowRef(createState())
  const result = shallowRef<RunResult | null>(null)
  const countdown = ref(3)
  const pauseReason = ref<'manual' | 'tracking' | 'hidden' | 'slow' | 'renderer'>('manual')
  const rendererReady = ref(false)
  const rendererError = ref('')
  const storageNotice = ref('')
  const elapsedTime = computed(() => {
    const seconds = Math.floor(state.value.tick / TICK_RATE)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  })
  const cameraTracked = computed(() => camera.phase.value === 'running' && camera.movement.value.tracking === 'tracked')

  let config: RunConfig = { seed: 'monad-paris-preview', simulationVersion: SIMULATION_VERSION }
  let course = createCourse(config)
  let previous = state.value
  let inputs: GameInput[] = []
  let runId = ''
  let runPseudo = ''
  let lastTime: number | null = null
  let accumulator = 0
  let countdownUntil = 0
  let startGeneration = 0
  const keys = new Set<string>()
  const touch = reactive({ lane: 0 as GameInput['lane'], action: 'none' as GameInput['action'] })

  function clearControls() {
    keys.clear()
    touch.lane = 0
    touch.action = 'none'
  }

  function countIn(time: number, seconds = 3) {
    phase.value = 'countdown'
    countdown.value = seconds
    countdownUntil = time + seconds * 1000
    accumulator = 0
    lastTime = time
  }

  function pause(reason: typeof pauseReason.value = 'manual') {
    if (phase.value === 'setup' || phase.value === 'finished') return
    phase.value = 'paused'
    pauseReason.value = reason
    accumulator = 0
    lastTime = null
    clearControls()
  }

  async function prepareCamera() {
    phase.value = 'preparing'
    if (camera.phase.value === 'idle') await camera.start()
  }

  async function start(control: typeof mode.value) {
    if (!rendererReady.value || rendererError.value || phase.value === 'connecting') return
    const generation = ++startGeneration
    clearControls()
    mode.value = control
    runPseudo = pseudo.value.trim().normalize('NFC').slice(0, 20) || 'Coureur'
    result.value = null
    phase.value = 'connecting'
    const prepared = prepareRun ? await prepareRun(runPseudo) : null
    if (generation !== startGeneration) return
    config = { seed: prepared?.seed || crypto.randomUUID(), simulationVersion: prepared?.simulationVersion || SIMULATION_VERSION }
    course = createCourse(config)
    state.value = createState()
    previous = state.value
    inputs = []
    runId = prepared?.runId || `local-${crypto.randomUUID()}`
    runPseudo = prepared?.pseudo || runPseudo
    result.value = null
    accumulator = 0
    lastTime = null
    if (control === 'camera') await prepareCamera()
    else {
      camera.stop()
      countIn(performance.now())
    }
  }

  async function resume() {
    if (!rendererReady.value || rendererError.value) return
    if (mode.value === 'camera') await prepareCamera()
    else countIn(performance.now())
  }

  function finish() {
    phase.value = 'finished'
    result.value = { ...config, runId, pseudo: runPseudo, score: state.value.score, coins: state.value.coins, tickCount: state.value.tick, inputs }
    try {
      localStorage.setItem('monad-blitz:pseudo', runPseudo)
      storageNotice.value = ''
    } catch {
      storageNotice.value = 'Le navigateur n’a pas pu mémoriser ton pseudo.'
    }
    camera.stop()
    clearControls()
  }

  function currentInput(): GameInput {
    if (mode.value === 'camera') return { ...camera.movement.value.input }
    const left = keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ')
    const right = keys.has('ArrowRight') || keys.has('KeyD')
    return {
      lane: touch.lane || (left === right ? 0 : left ? -1 : 1),
      action: touch.action !== 'none' ? touch.action
        : keys.has('Space') || keys.has('ArrowUp') ? 'jump'
          : keys.has('ArrowDown') || keys.has('KeyS') ? 'crouch' : 'none',
    }
  }

  function advance(time: number): RunnerFrame {
    if (phase.value === 'preparing' && camera.phase.value === 'running') {
      if (!camera.calibration.value.reference && !camera.calibrating.value) camera.beginCalibration()
      if (cameraTracked.value) countIn(time)
    }
    if (phase.value === 'paused' && pauseReason.value === 'tracking' && cameraTracked.value) countIn(time, 2)
    if ((phase.value === 'countdown' || phase.value === 'running') && mode.value === 'camera' && !cameraTracked.value) pause('tracking')
    if (phase.value === 'countdown') {
      countdown.value = Math.max(1, Math.ceil((countdownUntil - time) / 1000))
      if (time >= countdownUntil) {
        phase.value = 'running'
        lastTime = time
      }
    }
    if (phase.value === 'running') {
      const delta = lastTime === null ? 0 : time - lastTime
      lastTime = time
      if (delta > 250) pause('slow')
      else {
        accumulator += Math.max(0, delta)
        while (accumulator >= 1000 / TICK_RATE && phase.value === 'running') {
          const input = currentInput()
          course = updateCourse(config, course, state.value.distance)
          previous = state.value
          state.value = stepGame(state.value, input, course)
          const lastInput = inputs.at(-1)
          inputs.push(lastInput?.lane === input.lane && lastInput.action === input.action ? lastInput : input)
          accumulator -= 1000 / TICK_RATE
          if (state.value.status === 'finished') finish()
        }
      }
    }
    return { state: state.value, previous, alpha: phase.value === 'running' ? accumulator / (1000 / TICK_RATE) : 1, course, firstPerson: firstPerson.value }
  }

  function quit() {
    startGeneration++
    camera.stop()
    clearControls()
    phase.value = 'setup'
    accumulator = 0
    lastTime = null
  }

  function onRendererError(message: string) {
    rendererReady.value = false
    rendererError.value = message
    pause('renderer')
    camera.stop()
  }

  function keydown(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable)) return
    if (event.code === 'Escape') {
      if (phase.value === 'running') pause()
      return
    }
    if (mode.value !== 'keyboard' || !['running', 'countdown'].includes(phase.value)) return
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyQ', 'KeyD', 'KeyS', 'Space'].includes(event.code)) {
      event.preventDefault()
      keys.add(event.code)
    }
  }

  function keyup(event: KeyboardEvent) { keys.delete(event.code) }
  function blur() { if (phase.value === 'running' || phase.value === 'countdown') pause('hidden') }
  function hidden() { if (document.hidden) blur() }

  onMounted(() => {
    try {
      pseudo.value = (localStorage.getItem('monad-blitz:pseudo') ?? '').slice(0, 20)
    } catch { storageNotice.value = 'Le stockage local est indisponible dans ce navigateur.' }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', hidden)
  })
  onBeforeUnmount(() => {
    startGeneration++
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
    window.removeEventListener('blur', blur)
    document.removeEventListener('visibilitychange', hidden)
    clearControls()
  })

  return { camera, phase, mode, firstPerson, pseudo, state, result, countdown, pauseReason, rendererReady, rendererError, storageNotice, elapsedTime, cameraTracked, touch, advance, start, resume, pause, quit, onRendererError }
}
