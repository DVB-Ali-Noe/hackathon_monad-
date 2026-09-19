import { randomBytes } from 'node:crypto'
import { encodeFunctionData, zeroHash } from 'viem'
import type { Hex } from 'viem'
import { SIMULATION_VERSION } from '../../../shared/game/engine.ts'
import { apiHandler, fail, hashToken, jsonBody, rateLimit, requirePlayer } from '../../utils/http.ts'
import { chainWriter, monadSurfAbi, versionHash } from '../../utils/contract.ts'

export default apiHandler(async (event) => {
  const body = await jsonBody(event)
  if (typeof body.requestKey !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(body.requestKey)) fail(400, 'Clé de création invalide.')
  const player = await requirePlayer(event)
  rateLimit(event, 'runs', 12, player.id)
  const chain = chainWriter(useRuntimeConfig(event))
  const id: Hex = `0x${hashToken(`${player.id}:${body.requestKey}`)}`
  const seed: Hex = `0x${randomBytes(32).toString('hex')}`
  await chain.write(encodeFunctionData({ abi: monadSurfAbi, functionName: 'startRun', args: [id, player.id, seed, versionHash] }), async () => (await chain.run(id)).playerId !== zeroHash)
  const run = await chain.run(id)
  const expiresAt = Number(run.createdAt) * 1000 + 86400000
  if (run.playerId !== player.id || run.pseudo !== player.pseudo || run.submittedBlock || expiresAt <= Date.now() || run.simulationVersion !== versionHash) fail(409, 'Cette création de partie a déjà été utilisée.')
  return { runId: id, playerId: player.id, pseudo: run.pseudo, seed: run.seed.slice(2), simulationVersion: SIMULATION_VERSION, expiresAt: new Date(expiresAt).toISOString() }
})
