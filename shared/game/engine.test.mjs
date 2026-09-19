import assert from 'node:assert/strict'
import test from 'node:test'
import { createCourse, updateCourse, createState, stepGame, replayRun, jumpHeight, itemLength, MOVING_RANGE, SIMULATION_VERSION, JUMP_TICKS } from './engine.ts'
import { safeLane } from './test-inputs.mjs'

const config = { seed: 'paris-test', simulationVersion: SIMULATION_VERSION }
const neutral = { lane: 0, action: 'none' }
const obstacle = kind => [{ id: 0, distance: 200, lane: 0, kind }]

test('la graine reproduit le parcours, une autre graine produit un autre parcours', () => {
  assert.deepEqual(createCourse(config), createCourse(config))
  assert.notDeepEqual(createCourse(config), createCourse({ ...config, seed: 'autre' }))
})

test('chaque rangée laisse un couloir libre et assez d’espace pour changer de geste', () => {
  for (let seed = 0; seed < 30; seed++) {
    const rows = new Map()
    for (const item of createCourse({ ...config, seed: String(seed) })) {
      if (item.kind === 'coin') continue
      rows.set(item.distance, [...(rows.get(item.distance) ?? []), item])
    }
    let last = 0
    for (const [distance, items] of rows) {
      assert.ok(new Set(items.map(item => item.lane)).size <= 2)
      assert.ok(distance - last >= 21000)
      last = distance
    }
  }
})

test('les collisions, le saut et l’accroupissement appliquent des règles distinctes', () => {
  assert.equal(stepGame(createState(), neutral, obstacle('block')).lives, 2)
  assert.equal(stepGame(createState(), { lane: 0, action: 'crouch' }, obstacle('crouch')).lives, 3)
  assert.equal(stepGame(createState(), neutral, obstacle('crouch')).lives, 2)
  const airborne = { ...createState(), jumpTicks: 30 }
  assert.equal(stepGame(airborne, neutral, obstacle('jump')).lives, 3)
  assert.equal(stepGame(airborne, neutral, obstacle('block')).lives, 2)
  assert.equal(stepGame(airborne, { lane: 0, action: 'crouch' }, obstacle('crouch')).lives, 2)
})

test('le saut dure 900 ms même si la commande caméra cesse plus tôt', () => {
  let state = stepGame(createState(), { lane: 0, action: 'jump' }, [])
  assert.equal(state.jumpTicks, JUMP_TICKS)
  for (let i = 0; i < 20; i++) state = stepGame(state, neutral, [])
  assert.ok(jumpHeight(state) > 900)
  for (let i = 20; i < JUMP_TICKS; i++) state = stepGame(state, neutral, [])
  assert.equal(state.jumpTicks, 0)
})

test('une commande de saut maintenue ne relance pas automatiquement un saut', () => {
  let state = createState()
  for (let i = 0; i < 120; i++) state = stepGame(state, { lane: 0, action: 'jump' }, [])
  assert.equal(state.jumpTicks, 0)
  state = stepGame(state, neutral, [])
  assert.equal(stepGame(state, { lane: 0, action: 'jump' }, []).jumpTicks, JUMP_TICKS)
})

test('les pièces sont collectées une fois et les impacts rapprochés ne cumulent pas les dégâts', () => {
  const items = [{ id: 0, distance: 200, lane: 0, kind: 'coin' }, ...obstacle('block')]
  let state = stepGame(createState(), neutral, items)
  assert.equal(state.coins, 1)
  assert.equal(state.lives, 2)
  state = stepGame(state, neutral, items)
  assert.equal(state.coins, 1)
  assert.equal(state.lives, 2)
})

test('le changement de couloir est déterministe et le moteur ne modifie pas l’état précédent', () => {
  const initial = createState()
  const frozen = Object.freeze({ ...initial })
  let state = frozen
  state = stepGame(state, { lane: 1, action: 'none' }, [])
  assert.equal(state.x, 1200)
  state = stepGame(state, { lane: 1, action: 'none' }, [])
  assert.equal(state.x, 2400)
  assert.deepEqual(frozen, initial)
})

test('la course dépasse 75 secondes, renouvelle les obstacles et reste rejouable jusqu’à la mort', () => {
  let course = createCourse(config)
  const inputs = []
  let state = createState()
  let renewals = 0
  while (state.tick < 18000) {
    const updated = updateCourse(config, course, state.distance)
    if (updated !== course) renewals++
    course = updated
    assert.ok(course.length < 120)
    const next = course.find(item => item.distance > state.distance && item.kind !== 'coin')
    assert.ok(next, 'la piste ne doit jamais devenir vide')
    const lane = safeLane(state, course)
    const input = { lane, action: 'none' }
    inputs.push(input)
    state = stepGame(state, input, course)
    assert.equal(state.status, 'running')
  }
  assert.equal(state.lives, 3)
  assert.ok(renewals > 30)
  assert.deepEqual(replayRun(config, inputs), state)
  while (state.status === 'running') {
    course = updateCourse(config, course, state.distance)
    const next = course.find(item => item.distance > state.distance && item.kind !== 'coin')
    const input = { lane: next.lane, action: 'none' }
    inputs.push(input)
    state = stepGame(state, input, course)
  }
  assert.equal(state.lives, 0)
  assert.deepEqual(replayRun(config, inputs), state)
  assert.throws(() => replayRun(config, [...inputs, neutral]))
})

test('les fenêtres se recouvrent exactement, même après plusieurs heures de course', () => {
  for (const distance of [0, 1600000, 300000000]) {
    const first = createCourse(config, distance)
    const second = createCourse(config, distance + 60000)
    const sharedWindow = item => item.distance + itemLength(item) + (item.speed ? MOVING_RANGE : 0) > distance + 60000
      && item.distance - (item.speed ? MOVING_RANGE : 0) <= distance + 180000
    assert.deepEqual(first.filter(sharedWindow), second.filter(sharedWindow))
    assert.equal(new Set(second.map(item => item.id)).size, second.length)
  }
})

test('les versions et commandes invalides sont rejetées', () => {
  assert.throws(() => createCourse({ ...config, simulationVersion: 'autre' }))
  assert.throws(() => stepGame(createState(), { lane: 2, action: 'none' }, []))
  assert.throws(() => stepGame(createState(), { lane: 0, action: 'fly' }, []))
  assert.throws(() => createCourse(config, Infinity))
})
