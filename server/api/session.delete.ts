import { deleteCookie } from 'h3'
import { apiHandler, cookieSettings, databaseFor, jsonBody, sessionHash } from '../utils/http.ts'

export default apiHandler(async (event) => {
  await jsonBody(event)
  const hash = sessionHash(event)
  if (hash) await databaseFor(event)`update players set session_expires_at = now() where session_hash = ${hash}`
  deleteCookie(event, cookieSettings(event).name, { path: '/' })
  return { cleared: true }
})
