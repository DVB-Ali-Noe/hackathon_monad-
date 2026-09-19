import { getRouterParam } from 'h3'
import { apiHandler, rateLimit, requirePlayer } from '../../../../utils/http.ts'
import { ownedRun } from '../../../../utils/runs.ts'
import { movementReader } from '../../../../utils/movements.ts'
import { decodeMovement } from '../../../../utils/movement-input.ts'

export default apiHandler(async (event) => {
  const player = await requirePlayer(event)
  rateLimit(event, 'movement-read', 120, player.id)
  const config = useRuntimeConfig(event)
  const run = await ownedRun(config, getRouterParam(event, 'runId'), player.id)
  const journal = movementReader(config)
  await journal.check()
  const progress = await journal.progress(run.id)
  return { runId: run.id, nextSequence: progress.count, historyHash: progress.historyHash,
    lastTick: progress.count ? progress.lastTick : null, lastInput: decodeMovement(progress.lastInput) }
})
