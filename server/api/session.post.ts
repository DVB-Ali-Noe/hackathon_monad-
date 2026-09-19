import { randomBytes } from 'node:crypto'
import { setCookie } from 'h3'
import { encodeFunctionData } from 'viem'
import type { Hex } from 'viem'
import { apiHandler, cookieSettings, fail, hashToken, jsonBody, rateLimit, sessionId } from '../utils/http.ts'
import { chainWriter, monadSurfAbi } from '../utils/contract.ts'

export default apiHandler(async (event) => {
  const body = await jsonBody(event)
  if (typeof body.pseudo !== 'string') fail(400, 'Choisis un pseudo.')
  const pseudo = body.pseudo.trim().normalize('NFC')
  if (!pseudo || pseudo.length > 20 || /[\p{Cc}\p{Cf}]/u.test(pseudo)) fail(400, 'Le pseudo doit contenir de 1 à 20 caractères visibles.')
  rateLimit(event, 'session', 20)
  const chain = chainWriter(useRuntimeConfig(event))
  await chain.check()
  let id = sessionId(event)
  const current = id ? await chain.player(id) : null
  if (!current || current.sessionExpiresAt * BigInt(1000) <= BigInt(Date.now())) {
    const token = randomBytes(32).toString('hex')
    id = `0x${hashToken(token)}`
    const { name, secure } = cookieSettings(event)
    setCookie(event, name, token, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 })
  }
  const playerId = id as Hex
  await chain.write(encodeFunctionData({ abi: monadSurfAbi, functionName: 'savePlayer', args: [playerId, pseudo] }), async () => (await chain.player(playerId)).pseudo === pseudo)
  return { playerId, pseudo }
})
