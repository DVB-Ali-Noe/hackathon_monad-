import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

if (!process.env.NUXT_DATABASE_URL) throw new Error('Configurer NUXT_DATABASE_URL avant la migration.')
const sql = postgres(process.env.NUXT_DATABASE_URL, { max: 1 })
try {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(10143, 260918)`
    await tx.unsafe(await readFile(new URL('../server/database/schema.sql', import.meta.url), 'utf8'))
  })
  console.log('Schéma des joueurs, parties et limites installé.')
} finally { await sql.end() }
