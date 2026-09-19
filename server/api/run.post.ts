import { encodeFunctionData, keccak256, toHex } from 'viem'
import { SIMULATION_VERSION } from '../../shared/game/engine.ts'
import { apiHandler, fail, jsonBody, rateLimit, requirePlayer } from '../utils/http.ts'
import { validateRun } from '../utils/replay.ts'
import { ownedRun } from '../utils/runs.ts'
import { chainWriter, monadSurfAbi } from '../utils/contract.ts'

export default apiHandler(async (event) => {
  const body = await jsonBody(event, 4 * 1024 * 1024)
  const player = await requirePlayer(event)
  rateLimit(event, 'submit', 6, player.id)
  const config = useRuntimeConfig(event)
  const run = await ownedRun(config, body.runId, player.id)
  if (!run.submittedBlock && Number(run.createdAt) * 1000 + 86400000 < Date.now()) fail(410, 'Cette partie a expiré.')
  let validated
  try {
    validated = validateRun(body, { id: run.id, pseudo: run.pseudo, seed: run.seed.slice(2), simulation_version: SIMULATION_VERSION, created_at: new Date(Number(run.createdAt) * 1000) })
  } catch (error) { fail(422, error instanceof Error ? error.message : 'Résultat invalide.') }
  const result = validated.result
  const inputs = toHex(Uint8Array.from(result.inputs, input => (input.lane + 1) * 3 + ['none', 'jump', 'crouch'].indexOf(input.action)))
  const chain = chainWriter(config)
  await chain.write(encodeFunctionData({ abi: monadSurfAbi, functionName: 'submitRun', args: [run.id, BigInt(result.score), BigInt(result.coins), result.tickCount, inputs] }), async () => (await chain.run(run.id)).submittedBlock !== BigInt(0))
  const saved = await chain.run(run.id)
  if (saved.replayHash !== keccak256(inputs) || saved.score !== BigInt(result.score) || saved.coins !== BigInt(result.coins) || saved.tickCount !== result.tickCount) fail(409, 'Un autre résultat est déjà enregistré pour cette partie.')
  return chain.status(run.id)
})
