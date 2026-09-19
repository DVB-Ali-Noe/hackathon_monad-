import { apiHandler, rateLimit } from '../utils/http.ts'
import { chainReader, monadSurfAbi } from '../utils/contract.ts'

export default apiHandler(async (event) => {
  rateLimit(event, 'leaderboard', 30)
  const { client, address, checkNetwork } = chainReader(useRuntimeConfig(event))
  await checkNetwork()
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 })
  const entries = await client.readContract({ address, abi: monadSurfAbi, functionName: 'getLeaderboard', blockNumber })
  return { blockNumber: blockNumber.toString(), entries: entries.map(entry => ({ playerId: entry.playerId, pseudo: entry.pseudo, score: entry.score.toString() })) }
})
