import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { useGameFullscreen } from '../composables/useGameFullscreen.ts'

function environment(t) {
  const events = new Map()
  let cleanup
  const document = {
    fullscreenElement: null,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name),
    async exitFullscreen() { this.fullscreenElement = null; events.get('fullscreenchange')?.() },
  }
  const target = ref({ async requestFullscreen() { document.fullscreenElement = target.value; events.get('fullscreenchange')?.() } })
  const globals = { ref, document, onMounted: callback => callback(), onBeforeUnmount: callback => { cleanup = callback } }
  const descriptors = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  const control = useGameFullscreen(target)
  t.after(() => {
    cleanup()
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { target, control, document, events, cleanup: () => cleanup() }
}

test('le plein écran suit l’entrée, la sortie par le navigateur et le nettoyage de la page', async (t) => {
  const env = environment(t)
  await env.control.toggleFullscreen()
  assert.equal(env.control.fullscreen.value, true)
  await env.document.exitFullscreen()
  assert.equal(env.control.fullscreen.value, false)
  await env.control.toggleFullscreen()
  env.cleanup()
  assert.equal(env.document.fullscreenElement, null)
  assert.equal(env.events.size, 0)
})

test('un refus du plein écran laisse un message et permet une nouvelle tentative', async (t) => {
  const env = environment(t)
  const request = env.target.value.requestFullscreen
  env.target.value.requestFullscreen = async () => { throw new Error('refusé') }
  await env.control.toggleFullscreen()
  assert.equal(env.control.fullscreen.value, false)
  assert.match(env.control.fullscreenError.value, /refusé/)
  env.target.value.requestFullscreen = request
  await env.control.toggleFullscreen()
  assert.equal(env.control.fullscreen.value, true)
  assert.equal(env.control.fullscreenError.value, '')
})
