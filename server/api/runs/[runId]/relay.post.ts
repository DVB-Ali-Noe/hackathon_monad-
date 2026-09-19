import { getRouterParam } from 'h3'
import { apiHandler, databaseFor, fail, jsonBody, rateLimit, requirePlayer } from '../../../utils/http.ts'
import { HEX_ID } from '../../../utils/replay.ts'
import { relayNext } from '../../../utils/relay.ts'
import { runStatus } from '../../../utils/runs.ts'
import type { StoredRun } from '../../../utils/runs.ts'

export default apiHandler(async (event) => {
  await jsonBody(event)
  const player = await requirePlayer(event)
  await rateLimit(event, 'relay', 30, player.id)
  const id = getRouterParam(event, 'runId') || ''
  if (!HEX_ID.test(id)) fail(400, 'Identifiant invalide.')
  const sql = databaseFor(event)
  const [run] = await sql<StoredRun[]>`select * from runs where id = ${id} and player_id = ${player.id}`
  if (!run) fail(404, 'Partie introuvable.')
  if (run.status === 'queued' || run.status === 'submitted') await relayNext(sql, useRuntimeConfig(event))
  const [updated] = await sql<StoredRun[]>`select * from runs where id = ${id}`
  return runStatus(updated!)
})
