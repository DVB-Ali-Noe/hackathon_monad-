import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMovement, decodeMovement } from '../server/utils/movement-input.ts'

test('mouvements : tous les états sont encodés sans ambiguïté, y compris la fin du saut', () => {
  const codes = new Set()
  for (const lane of [-1, 0, 1]) for (const action of ['none', 'jump', 'crouch']) {
    const value = parseMovement({ sequence: 0, tick: 0, lane, action })
    codes.add(value.input)
    assert.deepEqual(decodeMovement(value.input), { lane, action })
  }
  assert.equal(codes.size, 9)
  assert.equal(parseMovement({ sequence: 0, tick: 0, lane: 0, action: 'none' }).input, 3)
})

test('mouvements : refuse les commandes ambiguës et les indices hors limites', () => {
  const valid = { sequence: 0, tick: 0, lane: 0, action: 'jump' }
  for (const key of ['sequence', 'tick']) for (const value of [-1, 0.5, '0', null, undefined, NaN, Infinity, 108000]) {
    assert.throws(() => parseMovement({ ...valid, [key]: value }))
  }
  for (const lane of [-2, 2, '0', null, 0.1]) assert.throws(() => parseMovement({ ...valid, lane }))
  for (const action of ['run', '', 0, null]) assert.throws(() => parseMovement({ ...valid, action }))
  assert.deepEqual(parseMovement({ ...valid, sequence: 107999, tick: 107999 }), { sequence: 107999, tick: 107999, input: 4 })
})
