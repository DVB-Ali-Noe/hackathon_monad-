import type { LeaderboardSnapshot } from '../../shared/api'

export function parseLeaderboard(value: unknown): LeaderboardSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid leaderboard')
  const snapshot = value as Partial<LeaderboardSnapshot>
  if (typeof snapshot.blockNumber !== 'string' || !/^\d+$/.test(snapshot.blockNumber)
    || !Array.isArray(snapshot.entries) || !snapshot.entries.every(entry => entry
      && typeof entry.playerId === 'string' && entry.playerId.length > 0
      && (entry.pseudo === null || typeof entry.pseudo === 'string')
      && typeof entry.score === 'string' && /^\d+$/.test(entry.score))) throw new Error('Invalid leaderboard')
  return snapshot as LeaderboardSnapshot
}
