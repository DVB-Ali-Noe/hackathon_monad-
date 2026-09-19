import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, http, isAddress, keccak256, parseAbi, TransactionReceiptNotFoundError } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

export const monadSurfAbi = parseAbi([
  'function relayer() view returns (address)',
  'function getLeaderboard() view returns ((bytes32 playerId, uint64 score)[])',
  'function submitRun(bytes32 runId, bytes32 playerId, uint64 score, uint64 coins)',
  'event RunSubmitted(bytes32 indexed runId, bytes32 indexed playerId, uint64 score, uint64 coins)',
])

export type ChainConfig = { monadRpcUrl: string; monadContractAddress: string; relayerPrivateKey: string }
export type OnchainRun = { id: string; player_id: string; result: { score: number; coins: number } }

export function chainReader(config: Pick<ChainConfig, 'monadRpcUrl' | 'monadContractAddress'>) {
  if (!config.monadRpcUrl || !isAddress(config.monadContractAddress) || /^0x0{40}$/i.test(config.monadContractAddress)) {
    throw new Error('MONAD_NOT_CONFIGURED')
  }
  const address = config.monadContractAddress as Hex
  const client = createPublicClient({ chain: monadTestnet, transport: http(config.monadRpcUrl, { timeout: 5000, retryCount: 0 }) })
  async function checkNetwork() {
    if (await client.getChainId() !== monadTestnet.id) throw new Error('WRONG_CHAIN')
  }
  return { address, client, checkNetwork }
}

export function chainWriter(config: ChainConfig) {
  const { address, client, checkNetwork } = chainReader(config)
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.relayerPrivateKey)) throw new Error('RELAYER_NOT_CONFIGURED')
  const account = privateKeyToAccount(config.relayerPrivateKey as Hex)
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(config.monadRpcUrl, { timeout: 5000, retryCount: 0 }) })
  async function check() {
    await checkNetwork()
    const relayer = await client.readContract({ address, abi: monadSurfAbi, functionName: 'relayer' })
    if (relayer.toLowerCase() !== account.address.toLowerCase()) throw new Error('WRONG_RELAYER')
  }
  return {
    check,
    async prepare(run: OnchainRun) {
      await check()
      const request = await wallet.prepareTransactionRequest({
        to: address,
        data: encodeFunctionData({ abi: monadSurfAbi, functionName: 'submitRun', args: [run.id as Hex, run.player_id as Hex, BigInt(run.result.score), BigInt(run.result.coins)] }),
      })
      const raw = await wallet.signTransaction(request)
      return { raw, hash: keccak256(raw) }
    },
    async receipt(hash: Hex, run: OnchainRun): Promise<'pending' | 'confirmed' | 'failed'> {
      await checkNetwork()
      let receipt
      try { receipt = await client.getTransactionReceipt({ hash }) }
      catch (error) { if (error instanceof TransactionReceiptNotFoundError) return 'pending'; throw error }
      if (await client.getBlockNumber({ cacheTime: 0 }) < receipt.blockNumber + BigInt(1)) return 'pending'
      const block = await client.getBlock({ blockNumber: receipt.blockNumber })
      if (block.hash !== receipt.blockHash) return 'pending'
      if (receipt.status !== 'success' || receipt.from.toLowerCase() !== account.address.toLowerCase()
        || receipt.to?.toLowerCase() !== address.toLowerCase()) return 'failed'
      const matched = receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== address.toLowerCase()) return false
        try {
          const event = decodeEventLog({ abi: monadSurfAbi, eventName: 'RunSubmitted', data: log.data, topics: log.topics })
          return event.args.runId === run.id && event.args.playerId === run.player_id
            && event.args.score === BigInt(run.result.score) && event.args.coins === BigInt(run.result.coins)
        } catch { return false }
      })
      return matched ? 'confirmed' : 'failed'
    },
    async broadcast(raw: Hex) { await checkNetwork(); return wallet.sendRawTransaction({ serializedTransaction: raw }) },
  }
}
