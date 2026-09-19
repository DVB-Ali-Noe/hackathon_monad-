import { getRouterParam } from 'h3'
import { apiHandler, rateLimit, requirePlayer } from '../../utils/http.ts'
import { ownedRun } from '../../utils/runs.ts'
import { chainReader } from '../../utils/contract.ts'

export default apiHandler(async (event) => {
  const player = await requirePlayer(event)
  rateLimit(event, 'status', 30, player.id)
  const config = useRuntimeConfig(event)
  const run = await ownedRun(config, getRouterParam(event, 'runId'), player.id)
  return chainReader(config).status(run.id)
})
