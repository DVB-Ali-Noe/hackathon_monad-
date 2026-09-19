import assert from 'node:assert/strict'
import test from 'node:test'
import { createCourse, updateCourse, createState, stepGame, trainSurface, itemDistance, TRAIN_HEIGHT, TRAIN_LENGTH, TRAIN_CLEARANCE, BARRIER_HEIGHT, SIMULATION_VERSION } from './engine.ts'

const neutral = { lane: 0, action: 'none' }
const train = { id: 0, distance: 0, lane: 0, kind: 'train', length: TRAIN_LENGTH, ramp: true }

test('une rampe fait monter progressivement sur le toit sans collision', () => {
  let state = createState()
  let lastHeight = 0
  while (state.distance < 7000) {
    state = stepGame(state, neutral, [train])
    assert.ok(state.y >= lastHeight)
    assert.equal(state.lives, 3)
    assert.equal(state.grounded, true)
    lastHeight = state.y
  }
  assert.equal(state.y, TRAIN_HEIGHT)
  assert.equal(state.supportId, train.id)
})

test('un train sans rampe bloque le sol et une collision latérale ne retire qu’une vie', () => {
  const wall = { ...train, distance: 1000, ramp: false }
  let state = createState()
  for (let i = 0; i < 180; i++) state = stepGame(state, neutral, [wall])
  assert.equal(state.status, 'finished')
  assert.ok(state.distance < wall.distance)
  assert.equal(state.y, 0)
  state = { ...createState(), x: -2400, lane: -1, distance: 6000 }
  for (let i = 0; i < 65; i++) {
    state = stepGame(state, neutral, [wall])
    if (state.distance < wall.distance + wall.length) assert.ok(state.x <= -1320)
  }
  assert.equal(state.lives, 2)
  assert.equal(stepGame(state, neutral, [wall]).x, 0, 'le couloir redevient accessible après le train')
})

test('un saut de toit en toit garde son altitude et atterrit sur le deuxième train', () => {
  const course = [{ ...train, length: 10000 }, { ...train, id: 1, distance: 14000, ramp: false }]
  let state = { ...createState(), distance: 8500, y: TRAIN_HEIGHT, supportId: 0 }
  state = stepGame(state, { lane: 0, action: 'jump' }, course)
  let highest = state.y
  for (let i = 0; i < 60; i++) {
    state = stepGame(state, neutral, course)
    highest = Math.max(highest, state.y)
  }
  assert.ok(highest > 5000)
  assert.equal(state.lives, 3)
  assert.equal(state.grounded, true)
  assert.equal(state.y, TRAIN_HEIGHT)
  assert.equal(state.supportId, 1)
})

test('quitter un toit entraîne une chute et interdit le saut après la tolérance de bord', () => {
  let state = { ...createState(), distance: 6000, y: TRAIN_HEIGHT, supportId: 0 }
  for (let i = 0; i < 9; i++) state = stepGame(state, { lane: 1, action: 'none' }, [train])
  assert.equal(state.grounded, false)
  state = stepGame(state, { lane: 1, action: 'jump' }, [train])
  assert.equal(state.jumpTicks, 0)
  assert.ok(state.y < TRAIN_HEIGHT)
  for (let i = 0; i < 40; i++) state = stepGame(state, { lane: 1, action: 'none' }, [train])
  assert.equal(state.y, 0)
  assert.equal(state.grounded, true)
  assert.equal(state.supportId, null)
})

test('un saut demandé juste avant l’atterrissage est conservé sans autoriser le double saut', () => {
  let state = { ...createState(), distance: 6000, y: TRAIN_HEIGHT, supportId: 0 }
  state = stepGame(state, { lane: 0, action: 'jump' }, [train])
  for (let i = 0; i < 51; i++) state = stepGame(state, neutral, [train])
  state = stepGame(state, { lane: 0, action: 'jump' }, [train])
  assert.ok(state.jumpTicks < 5, 'la nouvelle commande ne relance pas le saut en l’air')
  for (let i = 0; i < 4; i++) state = stepGame(state, neutral, [train])
  assert.ok(state.jumpTicks > 45, 'le saut en attente démarre après l’atterrissage')
})

test('les pièces du toit se ramassent depuis le toit, pas depuis le sol', () => {
  const course = [train, { id: 1, distance: 7000, lane: 0, kind: 'coin', elevation: TRAIN_HEIGHT }]
  const onRoof = { ...createState(), distance: 6800, y: TRAIN_HEIGHT, supportId: 0 }
  assert.equal(stepGame(onRoof, neutral, course).coins, 1)
  assert.equal(stepGame({ ...createState(), distance: 6800 }, neutral, course).coins, 0)
})

test('le renouvellement du parcours conserve un train déjà engagé et une rampe est présente dès le départ', () => {
  const config = { seed: 'toits', simulationVersion: SIMULATION_VERSION }
  const first = createCourse(config).find(item => item.kind === 'train')
  assert.equal(first.ramp, true)
  assert.ok(createCourse(config, first.distance + 12000).some(item => item.id === first.id))
})

test('revenir vers le flanc après avoir évité la rampe ne permet jamais d’entrer dans le wagon', () => {
  for (const lane of [-1, 1]) {
    for (const distance of [2000, 7000, 15000]) {
      let state = { ...createState(), lane, x: lane * 2400, distance, invulnerableTicks: 60 }
      for (let i = 0; i < 8; i++) {
        state = stepGame(state, neutral, [train])
        assert.ok(Math.abs(state.x) >= 1300, `le personnage traverse le flanc à ${distance} mm`)
        assert.equal(state.y, 0)
        assert.equal(state.lives, 3, 'l’invulnérabilité évite les dégâts, pas les collisions')
      }
    }
  }
})

test('un impact frontal arrête le personnage devant le volume du train', () => {
  const wall = { ...train, distance: 1000, ramp: false }
  let state = { ...createState(), distance: 900 }
  state = stepGame(state, neutral, [wall])
  assert.ok(state.distance < wall.distance)
  assert.equal(state.lives, 2)
  for (let i = 0; i < 10; i++) {
    state = stepGame(state, neutral, [wall])
    assert.ok(state.distance < wall.distance)
  }
  for (let i = 0; i < 10; i++) state = stepGame(state, { lane: 1, action: 'none' }, [wall])
  assert.ok(state.distance > wall.distance)
  assert.equal(state.lives, 2)
})

test('le saut reste disponible quand le geste latéral précède le décollage d’une image', () => {
  const other = { ...train, id: 1, lane: 1, ramp: false }
  const course = [train, other]
  let state = { ...createState(), distance: 6000, y: TRAIN_HEIGHT, supportId: 0 }
  state = stepGame(state, { lane: 1, action: 'none' }, course)
  state = stepGame(state, { lane: 1, action: 'jump' }, course)
  assert.ok(state.jumpTicks > 0, 'le départ du toit doit tolérer le décalage entre les deux gestes')
  let highest = state.y
  for (let i = 0; i < 55; i++) {
    state = stepGame(state, { lane: 1, action: 'none' }, course)
    highest = Math.max(highest, state.y)
  }
  assert.ok(highest > 5000)
  assert.equal(state.lives, 3)
  assert.equal(state.supportId, other.id)
})

test('le saut détecté trois ticks après le bord rejoint le toit suivant', () => {
  const course = [{ ...train, length: 10000 }, { ...train, id: 1, distance: 14000, ramp: false }]
  let state = { ...createState(), distance: 9800, y: TRAIN_HEIGHT, supportId: 0 }
  for (let i = 0; i < 3; i++) state = stepGame(state, neutral, course)
  state = stepGame(state, { lane: 0, action: 'jump' }, course)
  assert.ok(state.jumpTicks > 0)
  for (let i = 0; i < 55; i++) state = stepGame(state, neutral, course)
  assert.equal(state.lives, 3)
  assert.equal(state.y, TRAIN_HEIGHT)
  assert.equal(state.supportId, 1)
})

test('une réception descendante sur une rampe reste un atterrissage, pas un impact latéral', () => {
  const falling = { ...createState(), distance: 2000, y: 1500, grounded: false, fallVelocity: 120 }
  const state = stepGame(falling, neutral, [train])
  assert.equal(state.lives, 3)
  assert.equal(state.grounded, true)
  assert.equal(state.y, trainSurface(train, state.distance))
  assert.equal(state.supportId, train.id)
})

test('descendre d’un toit vers la rampe voisine fonctionne à gauche comme à droite', () => {
  for (const lane of [-1, 1]) {
    for (const distance of [6500, 8000]) {
      const source = { ...train, ramp: false }
      const target = { ...train, id: 1, lane, distance: 6000 }
      let state = { ...createState(), distance, y: TRAIN_HEIGHT, supportId: source.id }
      for (let i = 0; i < 24; i++) {
        state = stepGame(state, { lane, action: 'none' }, [source, target])
        assert.equal(state.lives, 3)
        assert.ok(state.y >= trainSurface(target, state.distance))
      }
      assert.equal(state.supportId, target.id)
    }
  }
})

test('des changements rapides de direction ne placent jamais le joueur dans un train, même invulnérable', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const config = { seed: `contacts-${seed}`, simulationVersion: SIMULATION_VERSION }
    let state = createState()
    let course = createCourse(config)
    let random = seed
    let input = neutral
    for (let tick = 0; tick < 2400; tick++) {
      if (tick % 13 === 0) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0
        input = { lane: random % 3 - 1, action: ['none', 'jump', 'crouch'][random >>> 16 & 3] ?? 'none' }
      }
      course = updateCourse(config, course, state.distance)
      state = stepGame({ ...state, invulnerableTicks: 1000 }, input, course)
      for (const item of course) {
        const front = itemDistance(item, state.tick)
        if (item.kind !== 'train' || state.distance < front || state.distance >= front + item.length) continue
        assert.ok(Math.abs(state.x - item.lane * 2400) >= TRAIN_CLEARANCE || state.y >= trainSurface(item, state.distance, state.tick) - 30,
          `intersection : graine ${seed}, tick ${tick}, train ${item.id}`)
      }
      if (state.status === 'finished') break
    }
  }
})

test('atterrir sur le dessus d’une barrière ne retire pas de vie, la toucher de face en retire une', () => {
  const barrier = { id: 0, distance: 1000, length: 1000, lane: 0, kind: 'jump' }
  let state = { ...createState(), distance: 1000, y: 950, grounded: false, fallVelocity: 120 }
  state = stepGame(state, neutral, [barrier])
  assert.equal(state.lives, 3)
  assert.equal(state.y, BARRIER_HEIGHT)
  assert.equal(state.supportId, barrier.id)
  for (let i = 0; i < 10; i++) state = stepGame(state, neutral, [barrier])
  assert.equal(state.lives, 3)
  const frontal = stepGame({ ...createState(), distance: 900 }, neutral, [barrier])
  assert.equal(frontal.lives, 2)
  assert.ok(frontal.distance < barrier.distance)
})

test('les trains en sens inverse avancent avec les ticks et restent solides', () => {
  const incoming = { ...train, ramp: false, distance: 2000, speed: 100, encounterTick: 10 }
  assert.equal(itemDistance(incoming, 0) - itemDistance(incoming, 10), 1000)
  let state = createState()
  while (state.status === 'running' && state.tick < 30) state = stepGame(state, neutral, [incoming])
  assert.equal(state.status, 'finished')
  assert.ok(state.distance < itemDistance(incoming, state.tick))
  const config = { seed: 'trafic', simulationVersion: SIMULATION_VERSION }
  const course = createCourse(config)
  assert.ok(course.filter(item => item.kind === 'train').length >= 9)
  assert.ok(course.some(item => item.speed > 0))
})

test('un saut peut se réceptionner sur un train roulant sans perdre de vie', () => {
  const incoming = { ...train, ramp: false, distance: 5000, speed: 100, encounterTick: 20 }
  let state = { ...createState(), distance: 8000, y: 3100, grounded: false, fallVelocity: 120 }
  state = stepGame(state, neutral, [incoming])
  assert.equal(state.lives, 3)
  assert.equal(state.y, TRAIN_HEIGHT)
  assert.equal(state.supportId, incoming.id)
})
