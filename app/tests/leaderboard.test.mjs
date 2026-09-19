import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLeaderboard } from '../utils/leaderboard.ts'
import { nearestRival } from '../../shared/leaderboard.ts'

const entries = [
  { playerId: 'leader', pseudo: 'Leader', score: '1000' },
  { playerId: 'nearest', pseudo: 'Nearest', score: '300' },
  { playerId: 'middle', pseudo: 'Middle', score: '600' },
]

test('la cible est le score immédiatement supérieur, indépendamment de l’ordre', () => {
  const before = structuredClone(entries)
  assert.deepEqual(nearestRival(entries, 100), { ...entries[1], gap: '200' })
  assert.deepEqual(nearestRival(entries, 299), { ...entries[1], gap: '1' })
  assert.deepEqual(entries, before)
})

test('atteindre un score change de cible, dépasser plusieurs scores choisit le suivant', () => {
  assert.equal(nearestRival(entries, 300).playerId, 'middle')
  assert.equal(nearestRival(entries, 650).playerId, 'leader')
  assert.equal(nearestRival(entries, 1000), null)
  assert.equal(nearestRival(entries, 1200), null)
  assert.equal(nearestRival([], 0), null)
})

test('les ex æquo conservent une cible stable même si le serveur change leur ordre', () => {
  const tied = [entries[1], { playerId: 'another', pseudo: 'Another', score: '300' }]
  assert.equal(nearestRival(tied, 0).playerId, 'another')
  assert.equal(nearestRival([...tied].reverse(), 0).playerId, 'another')
})

test('les grands scores on-chain et leur écart restent exacts', () => {
  const large = [
    { playerId: 'higher', pseudo: null, score: '9007199254740994' },
    { playerId: 'closer', pseudo: null, score: '9007199254740993' },
  ]
  assert.deepEqual(nearestRival(large, 20), { ...large[1], gap: '9007199254740973' })
})

test('le format réel du backend accepte les pseudos absents et le classement vide', () => {
  const snapshot = { blockNumber: '123456', entries: [...entries, { playerId: 'unnamed', pseudo: null, score: '0' }] }
  assert.deepEqual(parseLeaderboard(snapshot), snapshot)
  assert.deepEqual(parseLeaderboard({ blockNumber: '123', entries: [] }).entries, [])
})

test('une réponse invalide est une erreur, jamais un classement vide ou un record', () => {
  for (const value of [null, '<html>Page not found</html>', {}, { entries: [] },
    { blockNumber: '123', entries: [null] },
    ...['-1', '1.5', 'NaN', '', 123].map(score => ({ blockNumber: '123', entries: [{ ...entries[0], score }] })),
  ]) assert.throws(() => parseLeaderboard(value), /Invalid leaderboard/)
})
