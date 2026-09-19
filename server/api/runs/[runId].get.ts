import { getRouterParam } from 'h3'
import { apiHandler, databaseFor, fail, requirePlayer } from '../../utils/http.ts'
import { HEX_ID } from '../../utils/replay.ts'
import { runStatus } from '../../utils/runs.ts'
import type { StoredRun } from '../../utils/runs.ts'

export default apiHandler(async (event) => {
  const player = await requirePlayer(event)
  const id = getRouterParam(event, 'runId') || ''
  if (!HEX_ID.test(id)) fail(400, 'Identifiant invalide.')
  const [run] = await databaseFor(event)<StoredRun[]>`select * from runs where id = ${id} and player_id = ${player.id}`
  if (!run) fail(404, 'Partie introuvable.')
  return runStatus(run)
})
