import type postgres from 'postgres'
import type { Hex } from 'viem'
import { chainWriter } from './contract.ts'
import type { ChainConfig } from './contract.ts'
import type { StoredRun } from './runs.ts'

export async function relayNext(sql: ReturnType<typeof postgres>, config: ChainConfig) {
  const chain = chainWriter(config)
  const next = await sql.begin(async (tx) => {
    const [lock] = await tx<{ locked: boolean }[]>`select pg_try_advisory_xact_lock(10143, 260919) as locked`
    if (!lock!.locked) return null
    const [pending] = await tx<StoredRun[]>`select * from runs where status = 'submitted' order by created_at limit 1 for update`
    if (pending) {
      if (pending.contract_address !== config.monadContractAddress.toLowerCase()) throw new Error('PENDING_CONTRACT_MISMATCH')
      if (!pending.result || !pending.transaction_hash || !pending.raw_transaction) throw new Error('INVALID_OUTBOX')
      const status = await chain.receipt(pending.transaction_hash as Hex, { ...pending, result: pending.result })
      if (status === 'pending') return { raw: pending.raw_transaction as Hex }
      await tx`update runs set status = ${status}, error = ${status === 'failed' ? 'La transaction n’a pas confirmé ce résultat.' : null} where id = ${pending.id}`
    }
    const [run] = await tx<StoredRun[]>`select * from runs where status = 'queued' order by created_at limit 1 for update`
    if (!run) return null
    if (run.contract_address !== config.monadContractAddress.toLowerCase() || !run.result) throw new Error('QUEUED_CONTRACT_MISMATCH')
    const signed = await chain.prepare({ ...run, result: run.result })
    await tx`update runs set status = 'submitted', transaction_hash = ${signed.hash}, raw_transaction = ${signed.raw} where id = ${run.id}`
    return { raw: signed.raw }
  })
  // Le COMMIT précède toute diffusion : une reprise renvoie exactement les mêmes octets.
  if (next) {
    try { await chain.broadcast(next.raw) }
    catch { return { pending: true, broadcast: false } }
  }
  return { pending: !!next, broadcast: !!next }
}
