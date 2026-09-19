import type { LeaderboardEntry } from './api'

export function nearestRival(entries: readonly LeaderboardEntry[], score: number, playerId?: string) {
  if (!Number.isSafeInteger(score) || score < 0) throw new Error('Score courant invalide')
  const current = BigInt(score)
  let target: LeaderboardEntry | null = null
  for (const entry of entries) {
    if (entry.playerId.toLowerCase() === playerId?.toLowerCase() || BigInt(entry.score) <= current) continue
    if (!target || BigInt(entry.score) < BigInt(target.score)
      || BigInt(entry.score) === BigInt(target.score) && entry.playerId < target.playerId) target = entry
  }
  return target ? { ...target, gap: (BigInt(target.score) - current).toString() } : null
}
