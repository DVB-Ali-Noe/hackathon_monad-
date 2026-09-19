import { createHash } from 'node:crypto'
import { createError, defineEventHandler, getCookie, getHeader, getRequestIP, getRequestURL, getRequestWebStream, setHeader } from 'h3'
import type { H3Event } from 'h3'
import type { Hex } from 'viem'
import { chainReader } from './contract.ts'

export function fail(statusCode: number, message: string): never {
  throw createError({ statusCode, data: { message } })
}

export function apiHandler<T>(handler: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store')
    try { return await handler(event) }
    catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      if (error instanceof Error && error.message === 'CHAIN_WRITE_LIMIT') fail(429, 'Le quota d’enregistrement est atteint. Réessaie dans une minute.')
      fail(503, 'Le service est temporairement indisponible. Réessaie dans un instant.')
    }
  })
}

export function cookieSettings(event: H3Event) {
  const config = useRuntimeConfig(event)
  const secure = new URL(config.siteOrigin || getRequestURL(event).origin).protocol === 'https:'
  return { name: secure ? '__Host-monad-session' : 'monad-session', secure }
}

export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex') }

export function sessionId(event: H3Event): Hex | null {
  const token = getCookie(event, cookieSettings(event).name)
  return token && /^[a-f0-9]{64}$/.test(token) ? `0x${hashToken(token)}` : null
}

export async function requirePlayer(event: H3Event) {
  const id = sessionId(event)
  if (!id) fail(401, 'La session a expiré. Reviens à la préparation.')
  const chain = chainReader(useRuntimeConfig(event))
  await chain.checkNetwork()
  const player = await chain.player(id)
  if (player.sessionExpiresAt * BigInt(1000) <= BigInt(Date.now())) fail(401, 'La session a expiré. Reviens à la préparation.')
  return { id, pseudo: player.pseudo }
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
      if (size > limit) { await reader.cancel(); fail(413, 'Requête trop volumineuse.') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  if (size > limit) fail(413, 'Requête trop volumineuse.')
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Corps JSON invalide.')
    return body as Record<string, unknown>
  } catch { fail(400, 'Corps JSON invalide.') }
}

const limits = new Map<string, { count: number; expires: number }>()

export function rateLimit(event: H3Event, scope: string, limit: number, identity?: string) {
  const ip = process.env.VERCEL ? getHeader(event, 'x-vercel-forwarded-for')?.split(',')[0] : getRequestIP(event)
  const key = `${scope}:${hashToken(identity || ip || 'unknown')}`
  const now = Date.now()
  let entry = limits.get(key)
  if (!entry || entry.expires <= now) {
    if (limits.size >= 10000) {
      for (const [id, value] of limits) if (value.expires <= now) limits.delete(id)
      if (limits.size >= 10000) fail(429, 'Trop de requêtes. Réessaie dans une minute.')
    }
    entry = { count: 0, expires: now + 60000 }
    limits.set(key, entry)
  }
  if (++entry.count > limit) fail(429, 'Trop de requêtes. Attends une minute avant de réessayer.')
}
