import { apiHandler, databaseFor, fail, jsonBody, rateLimit, requirePlayer } from '../utils/http.ts'
import { HEX_ID, validateRun } from '../utils/replay.ts'
import { runStatus } from '../utils/runs.ts'
import type { StoredRun } from '../utils/runs.ts'

export default apiHandler(async (event) => {
  const player = await requirePlayer(event)
  await rateLimit(event, 'submit', 6, player.id)
  const body = await jsonBody(event, 4 * 1024 * 1024)
  if (typeof body.runId !== 'string' || !HEX_ID.test(body.runId)) fail(400, 'Identifiant de partie invalide.')
  const sql = databaseFor(event)
  const [run] = await sql<StoredRun[]>`select * from runs where id = ${body.runId} and player_id = ${player.id}`
  if (!run) fail(404, 'Partie introuvable.')
  if (!run.payload_hash && run.expires_at.getTime() <= Date.now()) fail(410, 'Cette partie a expiré.')
  let validated
  try { validated = validateRun(body, run) }
  catch (error) { fail(422, error instanceof Error ? error.message : 'Résultat invalide.') }
  const [accepted] = await sql<StoredRun[]>`
    update runs set payload_hash = ${validated.hash}, result = ${sql.json(validated.result)},
      status = case when status = 'ready' then 'queued' else status end
    where id = ${run.id} and (payload_hash = ${validated.hash} or (payload_hash is null and expires_at > now())) returning *`
  if (!accepted) fail(409, 'Un autre résultat est déjà enregistré pour cette partie, ou elle a expiré.')
  return runStatus(accepted)
})
