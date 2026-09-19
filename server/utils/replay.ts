import { createHash } from 'node:crypto'
import { replayRun, SIMULATION_VERSION, TICK_RATE } from '../../shared/game/engine.ts'
import type { GameInput, RunResult } from '../../shared/types'

export const MAX_TICKS = TICK_RATE * 60 * 30
export const HEX_ID = /^0x[0-9a-f]{64}$/
export type ExpectedRun = {
  id: string; pseudo: string; seed: string; simulation_version: string; created_at: Date
}

export function validateRun(body: unknown, expected: ExpectedRun, now = Date.now()) {
  if (!body || typeof body !== 'object') throw new Error('Résultat invalide.')
  const run = body as RunResult
  if (run.runId !== expected.id || run.pseudo !== expected.pseudo || run.seed !== expected.seed
    || run.simulationVersion !== expected.simulation_version || run.simulationVersion !== SIMULATION_VERSION) {
    throw new Error('Les paramètres de la partie ne correspondent pas à ceux du serveur.')
  }
  if (![run.tickCount, run.score, run.coins].every(value => Number.isSafeInteger(value) && value >= 0)
    || run.tickCount < 1 || run.tickCount > MAX_TICKS || !Array.isArray(run.inputs)
    || run.inputs.length !== run.tickCount) throw new Error('Durée, score ou commandes invalides (30 minutes maximum enregistrées).')
  if (run.tickCount * 1000 / TICK_RATE > now - expected.created_at.getTime() + 2000) {
    throw new Error('La durée simulée dépasse la durée écoulée depuis la création de la partie.')
  }
  const inputs: GameInput[] = run.inputs.map((input) => {
    if (!input || ![-1, 0, 1].includes(input.lane) || !['none', 'jump', 'crouch'].includes(input.action)) {
      throw new Error('Commande invalide.')
    }
    return { lane: input.lane, action: input.action }
  })
  const normalized: RunResult = {
    runId: run.runId, pseudo: expected.pseudo, seed: expected.seed, simulationVersion: expected.simulation_version,
    tickCount: run.tickCount, score: run.score, coins: run.coins, inputs,
  }
  const state = replayRun(normalized, inputs)
  if (state.status !== 'finished' || state.tick !== run.tickCount || state.score !== run.score || state.coins !== run.coins) {
    throw new Error('Le rejeu ne confirme pas le résultat annoncé ou la partie est inachevée.')
  }
  const json = JSON.stringify(normalized)
  return { result: normalized, json, hash: createHash('sha256').update(json).digest('hex') }
}
