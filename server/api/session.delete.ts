import { deleteCookie } from 'h3'
import { encodeFunctionData } from 'viem'
import { apiHandler, cookieSettings, jsonBody, rateLimit, sessionId } from '../utils/http.ts'
import { chainWriter, monadSurfAbi } from '../utils/contract.ts'

export default apiHandler(async (event) => {
  await jsonBody(event)
  rateLimit(event, 'session', 20)
  const id = sessionId(event)
  if (id) {
    const chain = chainWriter(useRuntimeConfig(event))
    await chain.write(encodeFunctionData({ abi: monadSurfAbi, functionName: 'revokeSession', args: [id] }), async () => (await chain.player(id)).sessionExpiresAt === BigInt(0))
  }
  const { name, secure } = cookieSettings(event)
  deleteCookie(event, name, { path: '/', secure, httpOnly: true, sameSite: 'strict' })
  return { cleared: true }
})
