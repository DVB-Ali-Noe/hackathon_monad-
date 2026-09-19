import assert from 'node:assert/strict'
import test from 'node:test'
import { nearestRival } from '../shared/leaderboard.ts'

const entries = [
  { playerId: '0x03', pseudo: 'Leader', score: '1000' },
  { playerId: '0x02', pseudo: 'Milieu', score: '700' },
  { playerId: '0x01', pseudo: 'Proche', score: '400' },
]

test('la cible change quand on atteint ou dépasse son score', () => {
  assert.equal(nearestRival(entries, 350).gap, '50')
  assert.equal(nearestRival(entries, 400).playerId, '0x02')
  assert.equal(nearestRival(entries, 720).gap, '280')
  assert.equal(nearestRival(entries, 1000), null)
  assert.equal(nearestRival([], 0), null)
  assert.equal(nearestRival(entries, 350, '0x01').playerId, '0x02')
})

test('les écarts restent exacts jusqu’au maximum uint64 et les égalités sont stables', () => {
  const maximum = { playerId: '0xFF', pseudo: null, score: '18446744073709551615' }
  assert.equal(nearestRival([maximum], 1).gap, '18446744073709551614')
  assert.equal(nearestRival([maximum], 1, '0xff'), null)
  assert.equal(nearestRival([{ ...entries[0], score: '400' }, entries[2]], 0).playerId, '0x01')
  assert.throws(() => nearestRival(entries, -1))
})
