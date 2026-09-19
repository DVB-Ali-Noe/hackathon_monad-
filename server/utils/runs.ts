import type { RunStatus } from '../../shared/api'
import type { RunResult } from '../../shared/types'

export type StoredRun = {
  id: string; player_id: string; pseudo: string; seed: string; simulation_version: string
  contract_address: string; created_at: Date; expires_at: Date; status: RunStatus['status']
  payload_hash: string | null; result: RunResult | null; transaction_hash: string | null
  raw_transaction: string | null; error: string | null
}

export function runStatus(run: StoredRun): RunStatus {
  return { runId: run.id, status: run.status, transactionHash: run.transaction_hash, error: run.error }
}
