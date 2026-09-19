import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import * as THREE from 'three'
import { createCourse, createState, itemDistance, SIMULATION_VERSION, TRAIN_HEIGHT, TRAIN_LENGTH } from '../../shared/game/engine.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('#shared/') ? new URL(`../../shared/${specifier.slice(8)}`, import.meta.url).href : specifier, context)
  },
})
const { createRunnerWorld } = await import('../utils/runner-world.ts')

function world(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const context = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}) })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => context }) } })
  const world = createRunnerWorld()
  t.after(() => {
    world.dispose()
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor)
    else delete globalThis.document
  })
  return world
}

function frame(state, course, firstPerson = false) { return { state, previous: state, alpha: 1, course, firstPerson } }

test('les toits et rampes affichés rejoignent la hauteur et la longueur des collisions', (t) => {
  const view = world(t)
  const course = [{ id: 0, kind: 'train', lane: 0, distance: 30000, length: TRAIN_LENGTH, ramp: true }]
  view.update(frame(createState(), course))
  const box = name => {
    const object = view.scene.getObjectByName(name)
    assert.equal(object.count, 1)
    const matrix = new THREE.Matrix4()
    object.getMatrixAt(0, matrix)
    return new THREE.Box3().setFromBufferAttribute(object.geometry.getAttribute('position')).applyMatrix4(matrix)
  }
  const roof = box('train-roofs')
  const ramp = box('ramps')
  assert.ok(Math.abs(roof.max.y - TRAIN_HEIGHT / 1000) < 0.001)
  assert.ok(Math.abs(ramp.max.y - roof.max.y) < 0.001)
  assert.ok(Math.abs(ramp.min.z - roof.max.z) < 0.001)
  assert.ok(Math.abs(roof.min.z + 48) < 0.001)
})

test('le personnage reste cadré au sol et sur les toits en portrait et en paysage', (t) => {
  const view = world(t)
  for (const aspect of [0.6, 1, 16 / 9]) {
    view.camera.aspect = aspect
    view.camera.updateProjectionMatrix()
    for (const y of [0, TRAIN_HEIGHT, 5200]) {
      for (const x of [-2400, 0, 2400]) {
        view.update(frame({ ...createState(), x, y }, []))
        view.camera.updateMatrixWorld(true)
        for (const height of [0, 2.23]) {
          const point = new THREE.Vector3(x / 1000, y / 1000 + height, 0).project(view.camera)
          assert.ok(Math.abs(point.x) < 0.96 && Math.abs(point.y) < 0.96, `hors cadre : ${aspect}, ${x}, ${y}, ${height}`)
        }
      }
    }
  }
})

test('la scène recycle ses objets et affiche tous les trains visibles au cours d’une longue partie', (t) => {
  const view = world(t)
  const initialObjects = view.scene.children.length
  for (let i = 0; i < 40; i++) {
    const distance = i * 40000
    const course = createCourse({ seed: String(i % 4), simulationVersion: SIMULATION_VERSION }, Math.max(0, distance - 2000))
    view.update(frame({ ...createState(), distance }, course))
    assert.equal(view.scene.children.length, initialObjects)
    const visibleTrains = course.filter(item => item.kind === 'train' && itemDistance(item, 0) <= distance + 130000 && itemDistance(item, 0) + item.length >= distance - 6000)
    assert.equal(view.scene.getObjectByName('train-bodies').count, visibleTrains.length)
    view.scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) assert.ok(object.count <= object.instanceMatrix.count)
    })
  }
})

test('la vue FPV suit les yeux, le couloir et l’accroupissement sans afficher le personnage', (t) => {
  const view = world(t)
  for (const x of [-2400, 0, 2400]) {
    for (const y of [0, 3000, 5200]) {
      for (const crouching of [false, true]) {
        view.update(frame({ ...createState(), x, y, crouching }, [], true))
        assert.equal(view.camera.position.x, x / 1000)
        assert.equal(view.camera.position.y, y / 1000 + (crouching ? 0.9 : 1.75))
        assert.equal(view.scene.getObjectByName('player').visible, false)
        assert.equal(view.camera.fov, 78)
      }
    }
  }
  view.update(frame(createState(), [], false))
  assert.equal(view.scene.getObjectByName('player').visible, true)
  assert.equal(view.camera.fov, 58)
})

test('le rendu des trains roulants utilise la même position que la collision', (t) => {
  const view = world(t)
  const train = { id: 0, kind: 'train', lane: 0, distance: 10000, length: TRAIN_LENGTH, speed: 100, encounterTick: 200 }
  const matrix = new THREE.Matrix4()
  const positions = []
  for (const tick of [100, 200]) {
    view.update(frame({ ...createState(), tick }, [train], true))
    view.scene.getObjectByName('train-roofs').getMatrixAt(0, matrix)
    positions.push(matrix.elements[14])
    assert.equal(matrix.elements[14], -(itemDistance(train, tick) + TRAIN_LENGTH / 2) / 1000)
  }
  assert.equal(positions[1] - positions[0], 10)
})
