import { apiHandler, databaseFor, rateLimit } from '../utils/http.ts'
import { chainReader, monadSurfAbi } from '../utils/contract.ts'

export default apiHandler(async (event) => {
  await rateLimit(event, 'leaderboard', 30)
  const { client, address, checkNetwork } = chainReader(useRuntimeConfig(event))
  await checkNetwork()
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const entries = await client.readContract({ address, abi: monadSurfAbi, functionName: 'getLeaderboard', blockNumber })
  const ids = entries.map(entry => entry.playerId)
  const sql = databaseFor(event)
  const players = ids.length ? await sql<{ id: string; pseudo: string }[]>`select id, pseudo from players where id in ${sql(ids)}` : []
  const names = new Map(players.map(player => [player.id, player.pseudo]))
  return { blockNumber: blockNumber.toString(), entries: entries.map(entry => ({ playerId: entry.playerId, pseudo: names.get(entry.playerId) ?? null, score: entry.score.toString() })) }
})
