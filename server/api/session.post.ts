import { randomBytes } from 'node:crypto'
import { setCookie } from 'h3'
import { apiHandler, cookieSettings, databaseFor, fail, hashToken, jsonBody, rateLimit, sessionHash } from '../utils/http.ts'

export default apiHandler(async (event) => {
  const body = await jsonBody(event)
  if (typeof body.pseudo !== 'string') fail(400, 'Choisis un pseudo.')
  const pseudo = body.pseudo.trim().normalize('NFC')
  if (!pseudo || pseudo.length > 20 || /[\p{Cc}\p{Cf}]/u.test(pseudo)) fail(400, 'Le pseudo doit contenir de 1 à 20 caractères visibles.')
  await rateLimit(event, 'session', 20)
  const sql = databaseFor(event)
  const currentHash = sessionHash(event)
  if (currentHash) {
    const [player] = await sql<{ id: string; pseudo: string }[]>`
      update players set pseudo = ${pseudo} where session_hash = ${currentHash} and session_expires_at > now() returning id, pseudo`
    if (player) return { playerId: player.id, pseudo: player.pseudo }
  }
  const token = randomBytes(32).toString('hex')
  const id = `0x${randomBytes(32).toString('hex')}`
  await sql`insert into players (id, pseudo, session_hash, session_expires_at) values (${id}, ${pseudo}, ${hashToken(token)}, now() + interval '30 days')`
  const { name, secure } = cookieSettings(event)
  setCookie(event, name, token, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return { playerId: id, pseudo }
})
