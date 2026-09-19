export type LeaderboardEntry = { playerId: string; pseudo: string | null; score: string }
export type LeaderboardSnapshot = { entries: LeaderboardEntry[]; blockNumber: string }

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

export function nextLeaderboardRival(entries: readonly LeaderboardEntry[], score: number) {
  const current = BigInt(score)
  let target: LeaderboardEntry | null = null
  let targetScore = 0n
  for (const entry of entries) {
    const candidateScore = BigInt(entry.score)
    if (candidateScore <= current) continue
    if (!target || candidateScore < targetScore
      || candidateScore === targetScore && entry.playerId < target.playerId) {
      target = entry
      targetScore = candidateScore
    }
  }
  return target ? { ...target, gap: targetScore - current } : null
}
