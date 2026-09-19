import { timingSafeEqual } from 'node:crypto'
import { getHeader } from 'h3'
import { apiHandler, databaseFor, fail } from '../utils/http.ts'
import { relayNext } from '../utils/relay.ts'

export default apiHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const expected = Buffer.from(`Bearer ${config.relaySecret}`)
  const actual = Buffer.from(getHeader(event, 'authorization') || '')
  if (config.relaySecret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail(401, 'Accès refusé.')
  return relayNext(databaseFor(event), config)
})
