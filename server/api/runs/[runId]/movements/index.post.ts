import { getRouterParam } from 'h3'
import { apiHandler, fail, jsonBody, rateLimit, requirePlayer } from '../../../../utils/http.ts'
import { ownedRun } from '../../../../utils/runs.ts'
import { parseMovement } from '../../../../utils/movement-input.ts'
import { recordMovement } from '../../../../utils/movements.ts'

export default apiHandler(async (event) => {
  const body = await jsonBody(event, 512)
  let movement
  try { movement = parseMovement(body) }
  catch (error) { fail(400, error instanceof Error ? error.message : 'Mouvement invalide.') }
  const player = await requirePlayer(event)
  rateLimit(event, 'movement-write', 600, player.id)
  const config = useRuntimeConfig(event)
  const run = await ownedRun(config, getRouterParam(event, 'runId'), player.id)
  return recordMovement(config, run, movement)
})
