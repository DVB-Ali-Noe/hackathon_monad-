import type { RunConfig } from './types'

export type SessionInfo = { playerId: string; pseudo: string }
export type PreparedRun = RunConfig & SessionInfo & { runId: string; expiresAt: string }
export type RunStatus = {
  runId: string
  status: 'ready' | 'submitted' | 'confirmed'
  transactionHash: string | null
  error: string | null
}
export type LeaderboardEntry = { playerId: string; pseudo: string | null; score: string }
export type LeaderboardSnapshot = { entries: LeaderboardEntry[]; blockNumber: string }
