import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { computed, reactive, ref, shallowRef } from 'vue'
import { replayRun } from '../../shared/game/engine.ts'
import { safeLane } from '../../shared/game/test-inputs.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = specifier.startsWith('#shared/')
      ? new URL(`../../shared/${specifier.slice(8)}`, import.meta.url).href
      : specifier
    return nextResolve(source, context)
  },
})
const { useRunner } = await import('../composables/useRunner.ts')

function environment(t) {
  let now = 0
  let cleanup
  const events = new Map()
  const stored = new Map()
  const camera = {
    phase: ref('idle'), movement: shallowRef({ tracking: 'lost', input: { lane: 0, action: 'none' } }),
    calibration: shallowRef({ reference: null }), calibrating: ref(false), calibrationCalls: 0,
    async start() { this.phase.value = 'running' },
    stop() { this.phase.value = 'idle'; this.calibration.value = { reference: null }; this.calibrating.value = false; this.movement.value = { tracking: 'lost', input: { lane: 0, action: 'none' } } },
    beginCalibration() { this.calibrating.value = true; this.calibrationCalls++ },
  }
  const globals = {
    ref, shallowRef, computed, reactive, usePoseCamera: () => camera,
    onMounted: callback => callback(), onBeforeUnmount: callback => { cleanup = callback },
    performance: { now: () => now },
    window: { addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
    document: { hidden: false, addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    HTMLElement: class {},
  }
  const descriptors = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const runner = useRunner()
  runner.rendererReady.value = true
  t.after(() => {
    cleanup()
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return {
    runner, camera, events, stored,
    advance(milliseconds, step = 20) {
      let frame
      for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
        now += step
        frame = runner.advance(now)
      }
      return frame
    },
    jumpTime(milliseconds) { now += milliseconds; return runner.advance(now) },
  }
}

test('le clavier démarre après le compte à rebours, une pause ne produit aucun tick', async (t) => {
  const env = environment(t)
  await env.runner.start('keyboard')
  env.advance(2900)
  assert.equal(env.runner.state.value.tick, 0)
  env.advance(300)
  assert.ok(env.runner.state.value.tick > 0)
  env.runner.pause()
  const tick = env.runner.state.value.tick
  env.advance(2000)
  assert.equal(env.runner.state.value.tick, tick)
  await env.runner.resume()
  env.advance(3000)
  assert.equal(env.runner.state.value.tick, tick)
  env.advance(100)
  assert.ok(env.runner.state.value.tick > tick)
})

test('la course caméra se calibre sans second clic et se suspend en cas de perte', async (t) => {
  const env = environment(t)
  await env.runner.start('camera')
  env.advance(300)
  assert.equal(env.camera.calibrationCalls, 1)
  assert.equal(env.runner.state.value.tick, 0)
  env.camera.calibration.value = { reference: {} }
  env.camera.calibrating.value = false
  env.camera.movement.value = { tracking: 'tracked', input: { lane: 0, action: 'none' } }
  env.advance(3400)
  assert.equal(env.runner.phase.value, 'running')
  const tick = env.runner.state.value.tick
  env.camera.movement.value = { tracking: 'lost', input: { lane: 0, action: 'none' } }
  env.advance(1200)
  assert.equal(env.runner.phase.value, 'paused')
  assert.equal(env.runner.state.value.tick, tick)
  env.camera.movement.value = { tracking: 'tracked', input: { lane: 0, action: 'none' } }
  env.advance(1800)
  assert.equal(env.runner.state.value.tick, tick)
  env.advance(500)
  assert.equal(env.runner.phase.value, 'running')
  assert.ok(env.runner.state.value.tick > tick)
})

test('une interruption longue ne provoque pas un rattrapage de simulation', async (t) => {
  const env = environment(t)
  await env.runner.start('keyboard')
  env.advance(3300)
  const tick = env.runner.state.value.tick
  env.jumpTime(3000)
  assert.equal(env.runner.phase.value, 'paused')
  assert.equal(env.runner.pauseReason.value, 'slow')
  assert.equal(env.runner.state.value.tick, tick)
})

test('les commandes clavier sont libérées après perte du focus', async (t) => {
  const env = environment(t)
  await env.runner.start('keyboard')
  env.advance(3200)
  env.events.get('keydown')({ code: 'ArrowRight', target: null, preventDefault() {} })
  env.advance(100)
  assert.equal(env.runner.state.value.lane, 1)
  env.events.get('blur')()
  assert.equal(env.runner.phase.value, 'paused')
  await env.runner.resume()
  env.advance(3200)
  assert.equal(env.runner.state.value.lane, 0)
})

test('une partie terminée produit un résultat rejouable et mémorise uniquement le pseudo', async (t) => {
  const env = environment(t)
  env.runner.pseudo.value = 'Noé'
  await env.runner.start('keyboard')
  env.advance(79000)
  const result = env.runner.result.value
  assert.ok(result)
  const replay = replayRun(result, result.inputs)
  assert.equal(result.score, replay.score)
  assert.equal(result.coins, replay.coins)
  assert.equal(result.tickCount, result.inputs.length)
  assert.deepEqual([...env.stored], [['monad-blitz:pseudo', 'Noé']])
  await env.runner.start('keyboard')
  const frame = env.advance(3400)
  assert.ok(frame.state.tick > 0)
  env.runner.pause()
  const paused = env.advance(2000)
  assert.equal(paused.state.tick, frame.state.tick)
})

test('la course dépasse cinq minutes sans limite ni piste vide et conserve un rejeu exact', async (t) => {
  const env = environment(t)
  await env.runner.start('keyboard')
  let frame = env.advance(3020)
  for (let i = 0; i < 15000; i++) {
    const next = frame.course.find(item => item.distance > frame.state.distance && item.kind !== 'coin')
    assert.ok(next)
    env.runner.touch.lane = safeLane(frame.state, frame.course)
    frame = env.advance(20)
    assert.equal(env.runner.phase.value, 'running')
  }
  assert.ok(env.runner.state.value.tick >= 18000)
  assert.equal(env.runner.elapsedTime.value, '5:00')
  const pausedTick = frame.state.tick
  env.runner.pause()
  env.advance(10000)
  assert.equal(env.runner.state.value.tick, pausedTick)
  await env.runner.resume()
  env.advance(3100)
  for (let i = 0; i < 3000 && !env.runner.result.value; i++) {
    const next = frame.course.find(item => item.distance > frame.state.distance && item.kind !== 'coin')
    env.runner.touch.lane = next?.lane ?? 0
    frame = env.advance(20)
  }
  const result = env.runner.result.value
  assert.ok(result)
  assert.deepEqual(replayRun(result, result.inputs), env.runner.state.value)
  assert.equal(result.tickCount, result.inputs.length)
})

test('une erreur WebGL arrête la course et la caméra', async (t) => {
  const env = environment(t)
  await env.runner.start('camera')
  env.runner.onRendererError('Rendu indisponible')
  assert.equal(env.camera.phase.value, 'idle')
  assert.equal(env.runner.phase.value, 'paused')
  assert.equal(env.runner.rendererReady.value, false)
})
