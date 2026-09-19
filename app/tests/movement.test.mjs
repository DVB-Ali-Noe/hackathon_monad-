import assert from 'node:assert/strict'
import test from 'node:test'
import { calibrate, createCalibration, createMovement, readPose, recognize } from '../utils/movement.ts'

function landmarks() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.2, visibility: 0.99 }))
  points[0].y = 0.1
  for (const [left, right, y, width] of [[11, 12, 0.28, 0.2], [23, 24, 0.5, 0.14], [25, 26, 0.7, 0.14], [27, 28, 0.9, 0.14], [29, 30, 0.91, 0.14], [31, 32, 0.92, 0.14]]) {
    points[left] = { x: 0.5 - width / 2, y, visibility: 0.99 }
    points[right] = { x: 0.5 + width / 2, y, visibility: 0.99 }
  }
  return points
}

const reference = readPose(landmarks())
assert.ok(reference)

function sequence() {
  let state = createMovement()
  let time = 0
  const history = []
  return {
    get state() { return state },
    get time() { return time },
    history,
    feed(pose = reference, duration = 500, step = 50) {
      for (let elapsed = 0; elapsed < duration; elapsed += step) {
        time += step
        state = recognize(state, pose, reference, time)
        history.push(state.input)
      }
      return state
    },
  }
}

test('la lecture exige tête, bassin, jambes et pieds visibles et fiables', () => {
  assert.equal(reference.standing, true)
  for (const index of [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]) {
    const points = landmarks()
    points[index].visibility = 0.4
    assert.equal(readPose(points), null)
    points[index].visibility = 0.99
    points[index].y = 1.1
    assert.equal(readPose(points), null)
  }
  assert.equal(readPose([]), null)
  const invalid = landmarks()
  invalid[23].x = NaN
  assert.equal(readPose(invalid), null)
})

test('après calibration, la tête peut sortir du cadre pendant un saut sans perdre le suivi', () => {
  const run = sequence()
  run.feed()
  for (const rise of [0.015, 0.035, 0.055, 0.04, 0.02, 0]) {
    const points = landmarks().map(point => ({ ...point, y: point.y - rise * reference.height }))
    points[0].y = -0.02
    points[0].visibility = 0.2
    const pose = readPose(points, 4 / 3, reference)
    assert.ok(pose, 'le tronc et les pieds sont encore visibles')
    run.feed(pose, 50)
    assert.equal(run.state.tracking, 'tracked')
  }
  assert.ok(run.history.some(input => input.action === 'jump'))
})

test('le suivi accepte un bout de pied masqué, mais exige un appui visible de chaque côté', () => {
  const points = landmarks()
  points[31].visibility = 0.2
  points[32].visibility = 0.2
  points[25].visibility = 0.2
  assert.equal(readPose(points), null)
  assert.ok(readPose(points, 4 / 3, reference))
  for (const index of [27, 29]) points[index].visibility = 0.2
  assert.equal(readPose(points, 4 / 3, reference), null)
})

test('un tronc hors cadre reste une perte de suivi après calibration', () => {
  for (const index of [11, 12, 23, 24]) {
    const points = landmarks()
    points[index].x = 1.2
    assert.equal(readPose(points, 4 / 3, reference), null)
  }
})

test('la calibration attend une séquence stable et adapte la référence à la morphologie', () => {
  for (const scale of [0.7, 1]) {
    let state = createCalibration()
    const pose = { ...reference, height: reference.height * scale, shoulderWidth: reference.shoulderWidth * scale }
    for (let time = 0; time <= 1800; time += 50) state = calibrate(state, pose, time)
    assert.ok(state.reference)
    assert.ok(Math.abs(state.reference.height - pose.height) < 1e-10)
    assert.ok(Math.abs(state.reference.shoulderWidth - pose.shoulderWidth) < 1e-10)
    assert.equal(state.progress, 1)
    assert.equal(state.samples.length, 0)
  }
})

test('mouvement, perte du suivi et intervalle trop long réinitialisent la calibration', () => {
  let state = createCalibration()
  for (let time = 0; time <= 1000; time += 50) state = calibrate(state, reference, time)
  assert.ok(state.progress > 0.5)
  assert.equal(calibrate(state, null, 1050).progress, 0)
  assert.equal(calibrate(state, { ...reference, hipX: 0.55 }, 1050).progress, 0)
  assert.equal(calibrate(state, { ...reference, standing: false }, 1050).progress, 0)
  assert.equal(calibrate(state, { ...reference, hipX: 0.7 }, 1050).progress, 0)
  assert.equal(calibrate(state, reference, 1600).progress, 0)
  assert.equal(calibrate(createCalibration(), reference, 1800).reference, null)
})

test('gauche et droite suivent le miroir, et le retour au centre est explicite', () => {
  const run = sequence()
  run.feed()
  assert.equal(run.feed({ ...reference, hipX: 0.68 }).input.lane, -1)
  assert.equal(run.feed().input.lane, 0)
  assert.equal(run.feed({ ...reference, hipX: 0.32 }).input.lane, 1)
  assert.equal(run.feed().input.lane, 0)
})

test('un déplacement modéré et le retour au centre répondent en deux images à 20 Hz', () => {
  for (const [hipX, lane] of [[0.65, -1], [0.35, 1]]) {
    const run = sequence()
    run.feed()
    assert.equal(run.feed({ ...reference, hipX }, 100).input.lane, lane)
    assert.equal(run.feed(reference, 100).input.lane, 0)
  }
})

test('à 30 et 60 Hz, le couloir et le saut se confirment sur deux images', () => {
  for (const step of [1000 / 30, 1000 / 60]) {
    const run = sequence()
    run.feed(reference, 700, step)
    const side = { ...reference, hipX: 0.33 }
    assert.equal(run.feed(side, step, step).input.lane, 0)
    assert.equal(run.feed(side, step, step).input.lane, 1)
    run.feed(reference, 300, step)
    const airborne = { ...reference, hipY: 0.46, shoulderY: 0.24, leftFootY: 0.88, rightFootY: 0.88 }
    assert.equal(run.feed(airborne, step, step).input.action, 'none')
    assert.equal(run.feed(airborne, step, step).input.action, 'jump')
  }
})

test('un petit déplacement reste au centre et une grande traversée ne saute pas deux couloirs', () => {
  const run = sequence()
  run.feed()
  assert.equal(run.feed({ ...reference, hipX: 0.62 }).input.lane, 0)
  assert.equal(run.feed({ ...reference, hipX: 0.68 }).input.lane, -1)
  const before = run.history.length
  assert.equal(run.feed({ ...reference, hipX: 0.32 }, 500).input.lane, 0)
  assert.ok(run.history.slice(before).every(input => input.lane !== 1))
  run.feed(reference, 200)
  assert.equal(run.feed({ ...reference, hipX: 0.32 }, 100).input.lane, 1)
})

test('le retour au centre ne rebondit pas dans le couloir opposé', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, hipX: 0.68 })
  run.feed(reference, 100)
  assert.equal(run.state.input.lane, 0)
  assert.equal(run.feed({ ...reference, hipX: 0.32 }, 100).input.lane, 0)
  run.feed(reference, 200)
  assert.equal(run.feed({ ...reference, hipX: 0.32 }, 100).input.lane, 1)
})

test('l’accroupissement est reconnu en moins de 100 ms à 30 et 60 Hz', () => {
  for (const step of [1000 / 30, 1000 / 60]) {
    const run = sequence()
    run.feed(reference, 700, step)
    assert.equal(run.feed({ ...reference, hipY: 0.65, shoulderY: 0.43 }, 99, step).input.action, 'crouch')
  }
})

test('le bruit et une excursion latérale isolée ne changent pas de couloir', () => {
  const run = sequence()
  run.feed()
  for (let i = 0; i < 25; i++) run.feed({ ...reference, hipX: 0.5 + (i % 2 ? 0.025 : -0.025) }, 50)
  run.feed({ ...reference, hipX: 0.75 }, 50)
  run.feed()
  assert.ok(run.history.every(input => input.lane === 0 && input.action === 'none'))
})

test('l’hystérésis maintient le couloir près du seuil et libère au centre', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, hipX: 0.68 })
  assert.equal(run.feed({ ...reference, hipX: 0.61 }).input.lane, -1)
  assert.equal(run.feed({ ...reference, hipX: 0.52 }).input.lane, 0)
})

test('buste seul, un pied levé et pointes des pieds ne déclenchent pas de saut', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, shoulderY: 0.2 })
  run.feed({ ...reference, shoulderY: 0.2, hipY: 0.4, leftFootY: 0.8 })
  run.feed({ ...reference, shoulderY: 0.24, hipY: 0.46 })
  assert.ok(run.history.every(input => input.action === 'none'))
  const tips = landmarks()
  tips[27].y -= 0.06
  tips[28].y -= 0.06
  assert.equal(readPose(tips).leftFootY, reference.leftFootY)
})

test('un saut produit une seule impulsion, puis nécessite un retour au sol', () => {
  const run = sequence()
  const airborne = { ...reference, hipY: 0.4, shoulderY: 0.18, leftFootY: 0.82, rightFootY: 0.82 }
  run.feed()
  run.feed(airborne, 1400)
  assert.equal(run.state.input.action, 'none')
  const countJumps = () => run.history.filter((input, index) => input.action === 'jump' && run.history[index - 1]?.action !== 'jump').length
  assert.equal(countJumps(), 1)
  run.feed(reference, 700)
  run.feed(airborne, 500)
  assert.equal(countJumps(), 2)
})

test('un petit saut bref est détecté sans devoir maintenir une position en l’air', () => {
  const run = sequence()
  run.feed()
  for (const rise of [0.01, 0.032, 0.048, 0.04, 0.018, 0]) {
    run.feed({
      ...reference,
      hipY: reference.hipY - rise * reference.height,
      shoulderY: reference.shoulderY - rise * reference.height,
      leftFootY: reference.leftFootY - rise * reference.height,
      rightFootY: reference.rightFootY - rise * reference.height,
    }, 50)
  }
  assert.ok(run.history.some(input => input.action === 'jump'))
})

test('une légère flexion des jambes pendant un saut ne masque pas le décollage', () => {
  const run = sequence()
  run.feed()
  for (const rise of [0.012, 0.035, 0.055, 0.06, 0.04, 0.01, 0]) {
    run.feed({
      ...reference,
      hipY: reference.hipY - rise * reference.height * 0.65,
      shoulderY: reference.shoulderY - rise * reference.height * 0.65,
      leftFootY: reference.leftFootY - rise * reference.height,
      rightFootY: reference.rightFootY - rise * reference.height,
    }, 50)
  }
  assert.ok(run.history.some(input => input.action === 'jump'))
})

test('un artefact vertical sur une seule image est filtré', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, hipY: 0.35, shoulderY: 0.13, leftFootY: 0.77, rightFootY: 0.77 }, 50)
  run.feed()
  assert.ok(run.history.every(input => input.action === 'none'))
})

test('une petite oscillation verticale ne devient pas un saut', () => {
  const run = sequence()
  run.feed()
  for (let i = 0; i < 30; i++) {
    const offset = Math.sin(i) * 0.015 * reference.height
    run.feed({
      ...reference, hipY: reference.hipY - offset, shoulderY: reference.shoulderY - offset,
      leftFootY: reference.leftFootY - offset, rightFootY: reference.rightFootY - offset,
    }, 50)
  }
  assert.ok(run.history.every(input => input.action === 'none'))
})

test('un faible décollage maintenu ne réarme pas le saut avant l’atterrissage', () => {
  const run = sequence()
  run.feed()
  run.feed({
    ...reference, hipY: reference.hipY - reference.height * 0.03,
    shoulderY: reference.shoulderY - reference.height * 0.03,
    leftFootY: reference.leftFootY - reference.height * 0.02,
    rightFootY: reference.rightFootY - reference.height * 0.02,
  }, 1500)
  assert.equal(run.history.filter((input, index) => input.action === 'jump' && run.history[index - 1]?.action !== 'jump').length, 1)
  assert.equal(run.state.jumpArmed, false)
})

test('les sauts brefs sont détectés à 10, 15 et 20 analyses par seconde', () => {
  for (const step of [50, 67, 100]) {
    const run = sequence()
    run.feed(reference, 700, step)
    for (let elapsed = step; elapsed < 350; elapsed += step) {
      const rise = Math.max(0, Math.sin(elapsed / 350 * Math.PI)) * 0.045 * reference.height
      run.feed({
        ...reference, hipY: reference.hipY - rise, shoulderY: reference.shoulderY - rise,
        leftFootY: reference.leftFootY - rise, rightFootY: reference.rightFootY - rise,
      }, step, step)
    }
    assert.ok(run.history.some(input => input.action === 'jump'), `saut manqué avec ${step} ms entre images`)
  }
})

test('l’accroupissement exige le bassin et les épaules abaissés, pieds au sol', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, shoulderY: 0.45 })
  assert.equal(run.state.input.action, 'none')
  const crouch = { ...reference, hipY: 0.65, shoulderY: 0.43, standing: false }
  assert.equal(run.feed(crouch).input.action, 'crouch')
  assert.equal(run.feed(crouch, 1200).input.action, 'crouch')
  assert.equal(run.feed().input.action, 'none')
})

test('une posture accroupie reste active malgré les variations de hauteur du buste', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, hipY: 0.65, shoulderY: 0.43 })
  const start = run.history.length
  for (let i = 0; i < 30; i++) {
    run.feed({
      ...reference,
      hipY: reference.hipY + reference.height * (0.09 + Math.sin(i) * 0.025),
      shoulderY: reference.shoulderY + reference.height * (0.06 + Math.cos(i) * 0.015),
    }, 50)
  }
  assert.ok(run.history.slice(start).every(input => input.action === 'crouch'))
  assert.equal(run.feed(reference, 500).input.action, 'none')
})

test('une variation des points des pieds ne libère pas un accroupissement déjà confirmé', () => {
  const run = sequence()
  const crouch = { ...reference, hipY: 0.65, shoulderY: 0.43 }
  run.feed()
  run.feed(crouch)
  const start = run.history.length
  run.feed({ ...crouch, leftFootY: 0.85, rightFootY: 0.85 }, 200)
  run.feed(crouch, 300)
  assert.ok(run.history.slice(start).every(input => input.action === 'crouch'))
})

test('la sortie d’accroupissement attend un redressement durable, puis reste réactive', () => {
  for (const step of [33, 50, 100]) {
    const run = sequence()
    const crouch = { ...reference, hipY: 0.65, shoulderY: 0.43 }
    run.feed(reference, 500, step)
    run.feed(crouch, 500, step)
    const start = run.history.length
    run.feed(reference, 100, step)
    run.feed(crouch, 300, step)
    assert.ok(run.history.slice(start).every(input => input.action === 'crouch'))
    assert.equal(run.feed(reference, 450, step).input.action, 'none')
  }
})

test('un changement de couloir peut accompagner un accroupissement', () => {
  const run = sequence()
  run.feed()
  assert.deepEqual(run.feed({ ...reference, hipX: 0.32, hipY: 0.65, shoulderY: 0.43 }).input, { lane: 1, action: 'crouch' })
})

test('un saut confirmé libère immédiatement l’accroupissement maintenu', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, hipY: 0.65, shoulderY: 0.43 })
  assert.equal(run.state.input.action, 'crouch')
  const airborne = { ...reference, hipY: 0.46, shoulderY: 0.24, leftFootY: 0.88, rightFootY: 0.88 }
  run.feed(airborne, 100)
  assert.equal(run.state.input.action, 'jump')
  assert.equal(run.state.crouchActive, false)
  run.feed(airborne, 500)
  assert.equal(run.state.input.action, 'none')
})

test('la perte de suivi neutralise immédiatement, puis la reprise doit se stabiliser', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, hipX: 0.68, hipY: 0.65, shoulderY: 0.43 })
  assert.equal(run.feed(null, 50).tracking, 'lost')
  assert.deepEqual(run.state.input, { lane: 0, action: 'none' })
  assert.equal(run.state.crouchActive, false)
  assert.equal(run.feed(reference, 100).tracking, 'recovering')
  assert.equal(run.feed().tracking, 'tracked')
  assert.deepEqual(run.state.input, { lane: 0, action: 'none' })
})

test('la reprise en l’air ne déclenche pas un nouveau saut sans retour au sol', () => {
  const run = sequence()
  run.feed()
  run.feed(null, 50)
  const start = run.history.length
  run.feed({ ...reference, hipY: 0.4, shoulderY: 0.18, leftFootY: 0.82, rightFootY: 0.82 }, 1000)
  assert.ok(run.history.slice(start).every(input => input.action === 'none'))
})

test('un long trou temporel réinitialise le suivi, une ancienne image est ignorée', () => {
  const run = sequence()
  run.feed()
  run.feed({ ...reference, hipX: 0.68 })
  const recovered = recognize(run.state, reference, reference, run.time + 1000)
  assert.equal(recovered.tracking, 'recovering')
  assert.deepEqual(recovered.input, { lane: 0, action: 'none' })
  assert.equal(recognize(run.state, reference, reference, run.time - 1), run.state)
})

test('les commandes restent cohérentes à différentes fréquences d’analyse', () => {
  for (const step of [33, 50, 100]) {
    const run = sequence()
    run.feed(reference, 700, step)
    assert.equal(run.feed({ ...reference, hipX: 0.68 }, 600, step).input.lane, -1)
    assert.equal(run.feed(reference, 600, step).input.lane, 0)
    assert.equal(run.feed({ ...reference, hipY: 0.65, shoulderY: 0.43 }, 600, step).input.action, 'crouch')
  }
})
