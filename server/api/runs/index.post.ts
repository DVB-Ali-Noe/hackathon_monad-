import { randomBytes } from 'node:crypto'
import { SIMULATION_VERSION } from '../../../shared/game/engine.ts'
import { apiHandler, databaseFor, fail, jsonBody, rateLimit, requirePlayer } from '../../utils/http.ts'
import { chainWriter } from '../../utils/contract.ts'
import type { StoredRun } from '../../utils/runs.ts'

export default apiHandler(async (event) => {
  const body = await jsonBody(event)
  if (typeof body.requestKey !== 'string' || !/^[\da-f-]{36}$/.test(body.requestKey)) fail(400, 'Clé de création invalide.')
  const player = await requirePlayer(event)
  await rateLimit(event, 'runs', 12, player.id)
  const config = useRuntimeConfig(event)
  await chainWriter(config).check()
  const sql = databaseFor(event)
  const id = `0x${randomBytes(32).toString('hex')}`
  const seed = randomBytes(32).toString('hex')
  const [run] = await sql<StoredRun[]>`
    insert into runs (id, player_id, request_key, pseudo, seed, simulation_version, contract_address)
    values (${id}, ${player.id}, ${body.requestKey}, ${player.pseudo}, ${seed}, ${SIMULATION_VERSION}, ${config.monadContractAddress.toLowerCase()})
    on conflict (player_id, request_key) do update set request_key = excluded.request_key returning *`
  if (run!.pseudo !== player.pseudo || run!.status !== 'ready' || run!.expires_at.getTime() <= Date.now()) fail(409, 'Cette création de partie a déjà été utilisée.')
  if (run!.simulation_version !== SIMULATION_VERSION || run!.contract_address !== config.monadContractAddress.toLowerCase()) fail(409, 'Cette partie appartient à une ancienne configuration.')
  return { runId: run!.id, playerId: player.id, pseudo: run!.pseudo, seed: run!.seed, simulationVersion: run!.simulation_version, expiresAt: run!.expires_at.toISOString() }
})
