import { calibrate, createCalibration, createMovement, readPose, recognize } from '../utils/movement.ts'
import type { Landmark } from '../utils/movement.ts'

type WorkerMessage =
  | { type: 'ready', delegate: 'GPU' | 'CPU' }
  | { type: 'error', stage: 'loading' | 'inference' }
  | { type: 'pose', landmarks: Landmark[], timestamp: number, inferenceMs: number, delegate: 'GPU' | 'CPU' }

export function usePoseCamera() {
  const video = ref<HTMLVideoElement | null>(null)
  const phase = ref<'idle' | 'requesting' | 'loading' | 'running'>('idle')
  const error = ref('')
  const notice = ref('')
  const landmarks = shallowRef<Landmark[]>([])
  const calibration = shallowRef(createCalibration())
  const movement = shallowRef(createMovement())
  const calibrating = ref(false)
  const calibrationCountdown = ref(0)
  const visible = ref(false)
  const aspectRatio = ref(4 / 3)
  const inferenceMs = ref(0)
  const frameMs = ref(0)
  const analysisFps = ref(0)
  const detectedJumps = ref(0)
  const delegate = ref<'GPU' | 'CPU' | ''>('')

  let stream: MediaStream | null = null
  let worker: Worker | null = null
  let generation = 0
  let animation = 0
  let videoCallback: number | null = null
  let latestVideoFrame: { time: number, mediaTime: number } | null = null
  let loadingTimer: ReturnType<typeof setTimeout> | undefined
  let busy = false
  let sentAt = 0
  let lastResult = 0
  let lastVideoTime = -1
  let calibrationStartsAt = 0

  function loseTracking() {
    visible.value = false
    landmarks.value = []
    movement.value = createMovement()
    if (calibrating.value) calibration.value = createCalibration()
  }

  function stop() {
    generation++
    cancelAnimationFrame(animation)
    if (videoCallback !== null) video.value?.cancelVideoFrameCallback(videoCallback)
    videoCallback = null
    latestVideoFrame = null
    clearTimeout(loadingTimer)
    worker?.terminate()
    worker = null
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.onmute = null
      track.stop()
    })
    stream = null
    if (video.value) {
      video.value.pause()
      video.value.srcObject = null
    }
    phase.value = 'idle'
    calibrating.value = false
    calibrationCountdown.value = 0
    calibrationStartsAt = 0
    calibration.value = createCalibration()
    loseTracking()
    inferenceMs.value = 0
    frameMs.value = 0
    analysisFps.value = 0
    detectedJumps.value = 0
    delegate.value = ''
    busy = false
    lastVideoTime = -1
    lastResult = 0
  }

  function fail(message: string) {
    stop()
    error.value = message
  }

  function frame(time: number) {
    if (phase.value !== 'running') return
    animation = requestAnimationFrame(frame)
    if (calibrationCountdown.value > 0) {
      calibrationCountdown.value = Math.max(0, Math.ceil((calibrationStartsAt - time) / 1000))
    }
    if (time - lastResult > 600) loseTracking()
    if (busy && time - sentAt > 8000) {
      fail('L’analyse ne répond plus. Réactive la caméra pour réessayer.')
      return
    }
    if (videoCallback === null) capture(time, video.value?.currentTime ?? -1)
  }

  function capture(time: number, mediaTime: number) {
    const element = video.value
    if (phase.value !== 'running' || busy || !element || element.readyState < 2 || !element.videoWidth
      || mediaTime === lastVideoTime) return

    busy = true
    sentAt = performance.now()
    lastVideoTime = mediaTime
    aspectRatio.value = element.videoWidth / element.videoHeight
    const session = generation
    const width = Math.min(640, element.videoWidth)
    // Un seul bitmap transférable en vol : aucune accumulation si l'inférence ralentit.
    createImageBitmap(element, { resizeWidth: width, resizeHeight: Math.round(width / aspectRatio.value) })
      .then((bitmap) => {
        if (session !== generation || !worker) {
          bitmap.close()
          return
        }
        try {
          worker.postMessage({ type: 'frame', bitmap, timestamp: time }, [bitmap])
        } catch {
          bitmap.close()
          fail('Impossible de transmettre les images à l’analyse. Essaie un navigateur récent.')
        }
      })
      .catch(() => {
        if (session === generation) fail('La caméra ne fournit plus d’images. Réactive-la pour réessayer.')
      })
  }

  function watchVideoFrames(session: number) {
    const element = video.value
    if (!element?.requestVideoFrameCallback) return
    videoCallback = element.requestVideoFrameCallback((time, metadata) => {
      if (session !== generation || phase.value !== 'running') return
      latestVideoFrame = { time, mediaTime: metadata.mediaTime }
      watchVideoFrames(session)
      capture(time, metadata.mediaTime)
    })
  }

  async function start() {
    stop()
    error.value = ''
    notice.value = ''
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      error.value = 'Caméra indisponible. Ouvre cette page en HTTPS ou sur localhost avec un navigateur récent.'
      return
    }
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      error.value = 'Ce navigateur ne permet pas l’analyse en arrière-plan. Essaie une version récente de Chrome ou Edge.'
      return
    }
    const session = generation
    phase.value = 'requesting'
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, max: 60 } },
        audio: false,
      })
      if (session !== generation) {
        acquired.getTracks().forEach(track => track.stop())
        return
      }
      stream = acquired
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => fail('La caméra a été déconnectée. Rebranche-la puis réessaie.')
        track.onmute = loseTracking
      })
      phase.value = 'loading'
      loadingTimer = setTimeout(() => {
        if (session === generation) fail('Le chargement de l’analyse a expiré. Vérifie ta connexion puis réessaie.')
      }, 45000)
      const element = video.value!
      element.srcObject = stream
      await element.play()
      if (session !== generation) return
      worker = new Worker('/pose.worker.js')
      worker.onerror = () => {
        if (session === generation) fail('Impossible de lancer l’analyse. Vérifie ta connexion et utilise un navigateur récent.')
      }
      worker.onmessageerror = () => {
        if (session === generation) fail('La communication avec l’analyse a été interrompue. Réessaie.')
      }
      worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
        if (session !== generation) return
        if (data.type === 'error') {
          fail(data.stage === 'loading'
            ? 'Le modèle n’a pas pu être chargé. Vérifie ta connexion et l’accès à jsDelivr et Google Storage, puis réessaie.'
            : 'L’analyse des mouvements a échoué. Réactive la caméra ou essaie un navigateur récent.')
          return
        }
        if (data.type === 'ready') {
          clearTimeout(loadingTimer)
          phase.value = 'running'
          delegate.value = data.delegate
          lastResult = performance.now()
          watchVideoFrames(session)
          animation = requestAnimationFrame(frame)
          return
        }
        busy = false
        const now = performance.now()
        frameMs.value = Math.round(now - data.timestamp)
        inferenceMs.value = Math.round(data.inferenceMs)
        if (data.delegate) delegate.value = data.delegate
        analysisFps.value = Math.round(1000 / Math.max(1, now - lastResult))
        lastResult = now
        // Repartir sur l'image la plus récente dès la libération du worker.
        if (videoCallback !== null) {
          if (latestVideoFrame) capture(latestVideoFrame.time, latestVideoFrame.mediaTime)
        } else capture(now, video.value?.currentTime ?? -1)
        if (now - data.timestamp > 600) {
          loseTracking()
          return
        }
        const pose = readPose(data.landmarks, aspectRatio.value, calibration.value.reference)
        visible.value = pose !== null
        landmarks.value = pose ? data.landmarks : []
        if (calibrating.value && data.timestamp >= calibrationStartsAt) {
          calibration.value = calibrate(calibration.value, pose, data.timestamp)
          if (calibration.value.reference) calibrating.value = false
        }
        if (calibration.value.reference) {
          const next = recognize(movement.value, pose, calibration.value.reference, data.timestamp)
          if (next.jumpUntil > movement.value.jumpUntil) detectedJumps.value++
          movement.value = next
        }
      }
      worker.postMessage({ type: 'init' })
    } catch (cause) {
      if (session !== generation) return
      const name = cause instanceof DOMException ? cause.name : ''
      const messages: Record<string, string> = {
        NotAllowedError: 'Accès à la caméra refusé. Autorise-la dans les paramètres du site, puis réessaie.',
        NotFoundError: 'Aucune caméra détectée. Branche une webcam, puis réessaie.',
        NotReadableError: 'La caméra est occupée ou inaccessible. Ferme les autres applications qui l’utilisent.',
        OverconstrainedError: 'Cette caméra ne peut pas fournir le format demandé. Essaie une autre webcam.',
        SecurityError: 'Le navigateur bloque la caméra. Vérifie les autorisations du site.',
      }
      fail(messages[name] ?? 'Impossible d’activer la caméra. Vérifie son branchement et les autorisations du navigateur.')
    }
  }

  function beginCalibration() {
    if (phase.value !== 'running' || calibrating.value) return
    calibration.value = createCalibration()
    movement.value = createMovement()
    calibrationCountdown.value = 5
    detectedJumps.value = 0
    calibrationStartsAt = performance.now() + 5000
    calibrating.value = true
  }

  function hide() {
    if (phase.value === 'idle') return
    stop()
    notice.value = 'Caméra arrêtée en quittant l’écran. Réactive-la pour reprendre.'
  }

  function visibilityChanged() {
    if (document.hidden) hide()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', hide)
  })
  onBeforeUnmount(() => {
    stop()
    document.removeEventListener('visibilitychange', visibilityChanged)
    window.removeEventListener('pagehide', hide)
  })

  return {
    video, phase, error, notice, landmarks, calibration, movement, calibrating, calibrationCountdown, visible,
    aspectRatio, inferenceMs, frameMs, analysisFps, detectedJumps, delegate, start, stop, beginCalibration,
  }
}
