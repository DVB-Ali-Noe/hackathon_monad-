import { createHash } from 'node:crypto'
import { createError, defineEventHandler, getCookie, getHeader, getRequestIP, getRequestURL, getRequestWebStream, setHeader } from 'h3'
import type { H3Event } from 'h3'
import { getDatabase } from './database.ts'

export function fail(statusCode: number, message: string): never {
  throw createError({ statusCode, data: { message } })
}

export function apiHandler<T>(handler: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store')
    try { return await handler(event) }
    catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      fail(503, 'Le service est temporairement indisponible. Réessaie dans un instant.')
    }
  })
}

export function databaseFor(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (!config.databaseUrl) fail(503, 'L’enregistrement des scores n’est pas encore configuré.')
  return getDatabase(config.databaseUrl)
}

export function cookieSettings(event: H3Event) {
  const config = useRuntimeConfig(event)
  const secure = new URL(config.siteOrigin || getRequestURL(event).origin).protocol === 'https:'
  return { name: secure ? '__Host-monad-session' : 'monad-session', secure }
}

export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex') }

export function sessionHash(event: H3Event) {
  const token = getCookie(event, cookieSettings(event).name)
  return token && /^[a-f0-9]{64}$/.test(token) ? hashToken(token) : null
}

export async function requirePlayer(event: H3Event) {
  const sql = databaseFor(event)
  const hash = sessionHash(event)
  if (!hash) fail(401, 'La session a expiré. Reviens à la préparation.')
  const [player] = await sql<{ id: string; pseudo: string }[]>`
    select id, pseudo from players where session_hash = ${hash} and session_expires_at > now()`
  if (!player) fail(401, 'La session a expiré. Reviens à la préparation.')
  return player
}

export function assertSameOrigin(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (!config.siteOrigin && process.env.VERCEL) fail(503, 'L’origine du site doit être configurée.')
  const expected = new URL(config.siteOrigin || getRequestURL(event).origin).origin
  if (getHeader(event, 'origin') !== expected || getHeader(event, 'sec-fetch-site') === 'cross-site') fail(403, 'Origine de requête refusée.')
  if (!/^application\/json(?:\s*;|$)/i.test(getHeader(event, 'content-type') || '')) fail(415, 'Un corps JSON est requis.')
}

export async function jsonBody(event: H3Event, limit = 4096): Promise<Record<string, unknown>> {
  assertSameOrigin(event)
  const declared = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit) fail(413, 'Requête trop volumineuse.')
  const stream = getRequestWebStream(event)
  if (!stream) fail(400, 'Corps JSON manquant.')
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size <= limit) chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  if (size > limit) fail(413, 'Requête trop volumineuse.')
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Corps JSON invalide.')
    return body as Record<string, unknown>
  } catch { fail(400, 'Corps JSON invalide.') }
}

export async function rateLimit(event: H3Event, scope: string, limit: number, identity?: string) {
  const sql = databaseFor(event)
  const ip = process.env.VERCEL ? getHeader(event, 'x-vercel-forwarded-for')?.split(',')[0] : getRequestIP(event)
  const key = `${scope}:${hashToken(identity || ip || 'unknown')}`
  const [entry] = await sql<{ count: number }[]>`
    insert into request_limits (key) values (${key})
    on conflict (key) do update set
      count = case when request_limits.window_start < now() - interval '1 minute' then 1 else request_limits.count + 1 end,
      window_start = case when request_limits.window_start < now() - interval '1 minute' then now() else request_limits.window_start end
    returning count`
  if (entry!.count > limit) fail(429, 'Trop de requêtes. Attends une minute avant de réessayer.')
}
