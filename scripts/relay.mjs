const origin = process.env.NUXT_SITE_ORIGIN
const secret = process.env.NUXT_RELAY_SECRET
if (!origin || !secret || secret.length < 32) throw new Error('Configurer NUXT_SITE_ORIGIN et NUXT_RELAY_SECRET.')
let stopped = false
process.on('SIGINT', () => { stopped = true })
process.on('SIGTERM', () => { stopped = true })
while (!stopped) {
  try {
    const response = await fetch(new URL('/api/relay', origin), {
      method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) console.error(`Relayer indisponible (HTTP ${response.status}).`)
  } catch { console.error('Relayer injoignable, nouvelle tentative dans cinq secondes.') }
  await new Promise(resolve => setTimeout(resolve, 5000))
}
