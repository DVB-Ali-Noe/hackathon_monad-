import postgres from 'postgres'

let database: ReturnType<typeof postgres> | undefined
let databaseUrl = ''

export function getDatabase(url: string) {
  if (!url) throw new Error('DATABASE_NOT_CONFIGURED')
  if (!database || databaseUrl !== url) {
    if (database) void database.end({ timeout: 1 })
    databaseUrl = url
    database = postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 5 })
  }
  return database
}
