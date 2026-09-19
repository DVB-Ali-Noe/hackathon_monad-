import { getRouterParam } from 'h3'
import { apiHandler, fail, rateLimit, requirePlayer } from '../../../../utils/http.ts'
import { ownedRun } from '../../../../utils/runs.ts'
import { movementReader } from '../../../../utils/movements.ts'

export default apiHandler(async (event) => {
  const value = getRouterParam(event, 'sequence') || ''
  if (!/^(0|[1-9][0-9]{0,5})$/.test(value) || Number(value) >= 108000) fail(400, 'Séquence invalide.')
  const player = await requirePlayer(event)
  rateLimit(event, 'movement-read', 120, player.id)
  const config = useRuntimeConfig(event)
  const run = await ownedRun(config, getRouterParam(event, 'runId'), player.id)
  const journal = movementReader(config)
  await journal.check()
  return journal.receipt(run.id, Number(value))
})
