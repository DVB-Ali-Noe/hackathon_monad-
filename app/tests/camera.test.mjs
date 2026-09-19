import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, shallowRef } from 'vue'
import { usePoseCamera } from '../composables/usePoseCamera.ts'

function environment(t, acquire, videoCallbacks = false) {
  let unmount
  let now = 0
  let id = 0
  const events = new Map()
  const frames = new Map()
  const videoFrames = new Map()
  const timers = new Map()
  const workers = []
  const bitmaps = []
  const track = { stopCount: 0, stop() { this.stopCount++ }, onended: null, onmute: null }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  let permissionRequests = 0
  const getUserMedia = () => {
    permissionRequests++
    return acquire ? acquire(stream) : Promise.resolve(stream)
  }
  const globals = {
    ref, shallowRef,
    onMounted: callback => callback(),
    onBeforeUnmount: callback => { unmount = callback },
    window: { isSecureContext: true, addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
    document: { hidden: false, addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
    navigator: { mediaDevices: { getUserMedia } },
    performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id },
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id },
    clearTimeout: key => timers.delete(key),
    OffscreenCanvas: class {},
    createImageBitmap: async () => {
      const bitmap = { closed: false, close() { this.closed = true } }
      bitmaps.push(bitmap)
      return bitmap
    },
    Worker: class {
      messages = []
      terminated = false
      constructor(url) { this.url = url; workers.push(this) }
      postMessage(message, transfer) { this.messages.push({ message, transfer }) }
      terminate() { this.terminated = true }
      emit(data) { this.onmessage({ data }) }
    },
  }
  const descriptors = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const camera = usePoseCamera()
  camera.video.value = { srcObject: null, play: async () => {}, pause() {}, readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0 }
  if (videoCallbacks) {
    camera.video.value.requestVideoFrameCallback = callback => { videoFrames.set(++id, callback); return id }
    camera.video.value.cancelVideoFrameCallback = key => videoFrames.delete(key)
  }
  t.after(() => {
    unmount()
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return {
    camera, workers, bitmaps, track, events, frames, videoFrames, timers, unmount,
    get permissionRequests() { return permissionRequests },
    async frame(time) {
      now = time
      camera.video.value.currentTime = time / 1000
      const pendingVideo = [...videoFrames.values()]
      videoFrames.clear()
      for (const callback of pendingVideo) callback(time, { mediaTime: time / 1000 })
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(time)
      await Promise.resolve()
    },
  }
}

test('la caméra et le worker attendent un clic explicite', (t) => {
  const env = environment(t)
  assert.equal(env.permissionRequests, 0)
  assert.equal(env.workers.length, 0)
  assert.equal(env.camera.phase.value, 'idle')
})

test('la caméra traite les images à 60 Hz sans plafond artificiel et annule ses callbacks à l’arrêt', async (t) => {
  const env = environment(t, undefined, true)
  await env.camera.start()
  const worker = env.workers[0]
  worker.emit({ type: 'ready', delegate: 'GPU' })
  for (let i = 1; i <= 60; i++) {
    const time = i * 1000 / 60
    await env.frame(time)
    worker.emit({ type: 'pose', landmarks: [], timestamp: time, inferenceMs: 10, delegate: 'GPU' })
  }
  assert.equal(worker.messages.filter(({ message }) => message.type === 'frame').length, 60)
  assert.equal(env.camera.delegate.value, 'GPU')
  assert.equal(env.camera.analysisFps.value, 60)
  env.camera.stop()
  assert.equal(env.videoFrames.size, 0)
  assert.equal(env.frames.size, 0)
})

test('un résultat libère immédiatement la dernière image disponible, sans file de captures anciennes', async (t) => {
  const env = environment(t, undefined, true)
  await env.camera.start()
  const worker = env.workers[0]
  worker.emit({ type: 'ready', delegate: 'CPU' })
  await env.frame(100)
  await env.frame(116)
  await env.frame(133)
  assert.equal(env.bitmaps.length, 1)
  worker.emit({ type: 'pose', landmarks: [], timestamp: 100, inferenceMs: 30, delegate: 'CPU' })
  await Promise.resolve()
  const captures = worker.messages.filter(({ message }) => message.type === 'frame')
  assert.equal(captures.length, 2)
  assert.equal(captures[1].message.timestamp, 133)
  worker.emit({ type: 'pose', landmarks: [], timestamp: 133, inferenceMs: 15, delegate: 'CPU' })
  await Promise.resolve()
  assert.equal(env.bitmaps.length, 2, 'une même image ne doit pas être analysée deux fois')
})

test('refus, absence et occupation de la caméra affichent une erreur récupérable', async (t) => {
  for (const [name, message] of [['NotAllowedError', 'refusé'], ['NotFoundError', 'Aucune caméra'], ['NotReadableError', 'occupée']]) {
    await t.test(name, async (t) => {
      const env = environment(t, () => Promise.reject(new DOMException('', name)))
      await env.camera.start()
      assert.equal(env.camera.phase.value, 'idle')
      assert.ok(env.camera.error.value.includes(message))
      assert.equal(env.workers.length, 0)
    })
  }
})

test('annuler une autorisation en attente libère aussi le flux reçu tardivement', async (t) => {
  let release
  const env = environment(t, stream => new Promise(resolve => { release = () => resolve(stream) }))
  const starting = env.camera.start()
  assert.equal(env.camera.phase.value, 'requesting')
  env.camera.stop()
  release()
  await starting
  assert.equal(env.track.stopCount, 1)
  assert.equal(env.workers.length, 0)
  assert.equal(env.camera.video.value.srcObject, null)
})

test('l’arrêt libère pistes, worker, aperçu, timers et boucle d’images', async (t) => {
  const env = environment(t)
  await env.camera.start()
  env.workers[0].emit({ type: 'ready' })
  assert.equal(env.camera.phase.value, 'running')
  env.camera.stop()
  assert.equal(env.track.stopCount, 1)
  assert.equal(env.workers[0].terminated, true)
  assert.equal(env.camera.video.value.srcObject, null)
  assert.equal(env.frames.size, 0)
  assert.equal(env.timers.size, 0)
  assert.equal(env.camera.calibration.value.reference, null)
})

test('quitter la page ou masquer l’onglet arrête la caméra', async (t) => {
  for (const exit of ['unmount', 'visibilitychange', 'pagehide']) {
    await t.test(exit, async (t) => {
      const env = environment(t)
      await env.camera.start()
      if (exit === 'unmount') env.unmount()
      else {
        document.hidden = true
        env.events.get(exit)()
      }
      assert.equal(env.track.stopCount, 1)
      assert.equal(env.workers[0].terminated, true)
      assert.equal(env.camera.phase.value, 'idle')
    })
  }
})

test('erreur de chargement, expiration et déconnexion arrêtent le flux', async (t) => {
  for (const failure of ['model', 'timeout', 'disconnected']) {
    await t.test(failure, async (t) => {
      const env = environment(t)
      await env.camera.start()
      if (failure === 'model') env.workers[0].emit({ type: 'error', stage: 'loading' })
      if (failure === 'timeout') [...env.timers.values()][0].callback()
      if (failure === 'disconnected') env.track.onended()
      assert.equal(env.track.stopCount, 1)
      assert.equal(env.workers[0].terminated, true)
      assert.ok(env.camera.error.value)
      assert.equal(env.camera.phase.value, 'idle')
    })
  }
})

test('une seule image est en vol et les résultats anciens sont rejetés', async (t) => {
  const env = environment(t)
  await env.camera.start()
  const worker = env.workers[0]
  worker.emit({ type: 'ready' })
  await env.frame(100)
  await env.frame(150)
  await env.frame(200)
  assert.equal(worker.messages.filter(({ message }) => message.type === 'frame').length, 1)
  assert.equal(worker.messages[1].transfer[0], env.bitmaps[0])
  await env.frame(800)
  worker.emit({ type: 'pose', landmarks: [], timestamp: 100, inferenceMs: 12 })
  assert.equal(env.camera.visible.value, false)
  assert.equal(env.camera.movement.value.tracking, 'lost')
  await env.frame(850)
  assert.equal(worker.messages.filter(({ message }) => message.type === 'frame').length, 2)
})

test('un bitmap créé après l’arrêt est fermé sans transfert', async (t) => {
  const env = environment(t)
  let release
  const bitmap = { closed: false, close() { this.closed = true } }
  globalThis.createImageBitmap = () => new Promise(resolve => { release = () => resolve(bitmap) })
  await env.camera.start()
  env.workers[0].emit({ type: 'ready' })
  await env.frame(100)
  env.camera.stop()
  release()
  await Promise.resolve()
  assert.equal(bitmap.closed, true)
  assert.equal(env.workers[0].messages.length, 1)
})

test('un worker bloqué finit par libérer la caméra et proposer de réessayer', async (t) => {
  const env = environment(t)
  await env.camera.start()
  env.workers[0].emit({ type: 'ready' })
  await env.frame(100)
  await env.frame(8200)
  assert.equal(env.track.stopCount, 1)
  assert.equal(env.workers[0].terminated, true)
  assert.ok(env.camera.error.value.includes('ne répond plus'))
})

test('une erreur tardive de l’ancien worker n’arrête pas une nouvelle session', async (t) => {
  const env = environment(t)
  await env.camera.start()
  const oldWorker = env.workers[0]
  await env.camera.start()
  oldWorker.onerror()
  oldWorker.onmessageerror()
  oldWorker.emit({ type: 'error', stage: 'loading' })
  assert.equal(env.camera.phase.value, 'loading')
  assert.equal(env.camera.error.value, '')
  assert.equal(env.workers[1].terminated, false)
})

test('la calibration se lance hors cadre, laisse cinq secondes puis attend le joueur sans second clic', async (t) => {
  const env = environment(t)
  await env.camera.start()
  const worker = env.workers[0]
  worker.emit({ type: 'ready' })
  assert.equal(env.camera.visible.value, false)
  env.camera.beginCalibration()
  assert.equal(env.camera.calibrationCountdown.value, 5)
  assert.equal(env.camera.calibrating.value, true)

  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.1, visibility: 0.99 }))
  for (const [left, right, y] of [[11, 12, 0.28], [23, 24, 0.5], [25, 26, 0.7], [27, 28, 0.9], [29, 30, 0.91], [31, 32, 0.92]]) {
    points[left] = { x: 0.4, y, visibility: 0.99 }
    points[right] = { x: 0.6, y, visibility: 0.99 }
  }
  for (let time = 100; time < 5000; time += 100) {
    await env.frame(time)
    worker.emit({ type: 'pose', landmarks: points, timestamp: time, inferenceMs: 12 })
    assert.equal(env.camera.calibration.value.progress, 0)
  }
  await env.frame(5000)
  assert.equal(env.camera.calibrationCountdown.value, 0)
  worker.emit({ type: 'pose', landmarks: points, timestamp: 4990, inferenceMs: 12 })
  assert.equal(env.camera.calibration.value.lastTime, null)

  await env.frame(5100)
  worker.emit({ type: 'pose', landmarks: [], timestamp: 5100, inferenceMs: 12 })
  assert.equal(env.camera.calibrating.value, true)
  assert.equal(env.camera.calibration.value.reference, null)
  for (let time = 5200; time <= 7000; time += 100) {
    await env.frame(time)
    worker.emit({ type: 'pose', landmarks: points, timestamp: time, inferenceMs: 12 })
  }
  assert.ok(env.camera.calibration.value.reference)
  assert.equal(env.camera.calibrating.value, false)

  for (let time = 7100; time <= 7600; time += 100) {
    await env.frame(time)
    worker.emit({ type: 'pose', landmarks: points, timestamp: time, inferenceMs: 12 })
  }
  const jumping = points.map(point => ({ ...point, y: point.y - 0.04 }))
  jumping[0].y = -0.02
  jumping[0].visibility = 0.1
  for (let time = 7700; time <= 8000; time += 100) {
    await env.frame(time)
    worker.emit({ type: 'pose', landmarks: jumping, timestamp: time, inferenceMs: 12 })
    assert.equal(env.camera.movement.value.tracking, 'tracked')
  }
  assert.equal(env.camera.detectedJumps.value, 1)
  assert.equal(env.camera.movement.value.input.action, 'none')
  env.camera.beginCalibration()
  assert.equal(env.camera.detectedJumps.value, 0)
  await env.frame(8100)
  worker.emit({ type: 'pose', landmarks: jumping, timestamp: 8100, inferenceMs: 12 })
  assert.equal(env.camera.visible.value, false)
})

test('l’arrêt pendant le compte à rebours annule la calibration', async (t) => {
  const env = environment(t)
  await env.camera.start()
  env.workers[0].emit({ type: 'ready' })
  env.camera.beginCalibration()
  await env.frame(1000)
  assert.equal(env.camera.calibrationCountdown.value, 4)
  env.camera.stop()
  await env.frame(6000)
  assert.equal(env.camera.calibrationCountdown.value, 0)
  assert.equal(env.camera.calibrating.value, false)
  assert.equal(env.camera.calibration.value.reference, null)
  assert.equal(env.frames.size, 0)
})
