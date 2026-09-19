import assert from 'node:assert/strict'
import test from 'node:test'
import { SIMULATION_VERSION } from '../shared/game/engine.ts'
import { validateRun, MAX_TICKS } from '../server/utils/replay.ts'
import { finishedRun } from './fixtures.mjs'

const run = finishedRun({ runId: `0x${'01'.repeat(32)}`, pseudo: 'Noé', seed: 'integration-replay', simulationVersion: SIMULATION_VERSION })
const expected = { id: run.runId, pseudo: run.pseudo, seed: run.seed, simulation_version: run.simulationVersion, created_at: new Date(Date.now() - 600000) }

test('le serveur recalcule une partie terminée et normalise son empreinte', () => {
  const validated = validateRun(run, expected)
  assert.equal(validated.result.score, run.score)
  assert.equal(validated.hash, validateRun({ ...run, extra: 'ignored' }, expected).hash)
})

test('le serveur refuse score, pièces, paramètres, inputs ou fin de partie falsifiés', () => {
  for (const change of [
    { score: run.score + 1 }, { coins: run.coins + 1 }, { score: NaN }, { score: Number.MAX_SAFE_INTEGER + 1 },
    { seed: 'another-seed' }, { pseudo: 'Imposteur' }, { simulationVersion: 'old' }, { runId: 'local-invalid' },
    { tickCount: run.tickCount + 1 }, { tickCount: MAX_TICKS + 1 }, { inputs: [{ lane: 10, action: 'none' }], tickCount: 1 },
    { inputs: [{ lane: 0, action: 'fly' }], tickCount: 1 }, { inputs: [], tickCount: 0 },
    { inputs: run.inputs.slice(0, -1), tickCount: run.tickCount - 1 },
    { inputs: [...run.inputs, { lane: 0, action: 'none' }], tickCount: run.tickCount + 1 },
  ]) assert.throws(() => validateRun({ ...run, ...change }, expected))
})

test('un résultat trop rapide est refusé ; les pauses réelles sont acceptées', () => {
  assert.throws(() => validateRun(run, { ...expected, created_at: new Date() }), /durée/)
  assert.doesNotThrow(() => validateRun(run, expected))
})
