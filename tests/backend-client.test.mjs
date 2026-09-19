import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, shallowRef } from 'vue'
import { useRunBackend } from '../app/composables/useRunBackend.ts'

const run = { runId: `0x${'aa'.repeat(32)}`, playerId: `0x${'bb'.repeat(32)}`, pseudo: 'Noé', seed: 'server-seed', simulationVersion: 'runner-5-oncoming-60hz', expiresAt: '2026-09-20T12:00:00Z' }
const ranking = { blockNumber: '100', entries: [{ playerId: `0x${'cc'.repeat(32)}`, pseudo: 'Rival', score: '18446744073709551615' }] }

function environment(t, fetcher) {
  let cleanup
  const previous = new Map()
  for (const [name, value] of Object.entries({ ref, shallowRef, onBeforeUnmount: callback => { cleanup = callback }, $fetch: fetcher })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const backend = useRunBackend()
  t.after(() => {
    cleanup()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  return backend
}

test('le navigateur prépare une partie serveur et ne charge le classement qu’une fois', async (t) => {
  const calls = []
  const backend = environment(t, async (path, options) => {
    calls.push({ path, options })
    if (path === '/api/session') return { playerId: run.playerId, pseudo: run.pseudo }
    if (path === '/api/leaderboard') return ranking
    return run
  })
  assert.deepEqual(await backend.prepare('Noé'), run)
  assert.equal(backend.playerId.value, run.playerId)
  assert.equal(backend.leaderboard.value.entries[0].score, ranking.entries[0].score)
  assert.equal(calls.filter(call => call.path === '/api/leaderboard').length, 1)
  assert.equal(backend.notice.value, '')
})

test('un service absent reste explicitement local et ne reçoit pas de résultat inventé', async (t) => {
  let calls = 0
  const backend = environment(t, async () => { calls++; throw new Error('Unavailable') })
  assert.equal(await backend.prepare('Noé'), null)
  assert.equal(backend.leaderboardState.value, 'unavailable')
  assert.match(backend.notice.value, /Partie locale/)
  const before = calls
  await backend.submit({ runId: 'local-123' })
  assert.equal(calls, before)
  assert.equal(backend.submission.value, null)
})

test('une réponse perdue se retente avec exactement le même résultat', async (t) => {
  const bodies = []
  const result = { ...run, score: 100, coins: 3, tickCount: 1, inputs: [{ lane: 0, action: 'none' }] }
  const backend = environment(t, async (path, options) => {
    if (path === '/api/run') {
      bodies.push(options.body)
      if (bodies.length === 1) throw new Error('Response lost')
      return { runId: run.runId, status: 'confirmed', transactionHash: '0x123', error: null }
    }
    throw new Error(`Unexpected ${path}`)
  })
  await backend.submit(result)
  assert.ok(backend.saveError.value)
  backend.retry()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(bodies.length, 2)
  assert.strictEqual(bodies[0], bodies[1])
  assert.equal(backend.submission.value.status, 'confirmed')
  assert.equal(backend.saveError.value, '')
})

test('une ancienne préparation ne remplace pas le nouvel instantané', async (t) => {
  let resolveOld
  let sessions = 0
  let rankings = 0
  const backend = environment(t, async (path) => {
    if (path === '/api/session') return { playerId: `${++sessions}`, pseudo: 'Noé' }
    if (path === '/api/leaderboard') {
      if (++rankings === 1) return new Promise(resolve => { resolveOld = resolve })
      return { entries: [], blockNumber: '200' }
    }
    return run
  })
  const old = backend.prepare('Avant')
  await new Promise(resolve => setImmediate(resolve))
  await backend.prepare('Après')
  resolveOld(ranking)
  assert.equal(await old, null)
  assert.equal(backend.leaderboard.value.blockNumber, '200')
})
