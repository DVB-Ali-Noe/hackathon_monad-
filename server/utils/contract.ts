import { createPublicClient, createWalletClient, http, isAddress, keccak256, parseAbi, stringToHex, zeroHash } from 'viem'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { SIMULATION_VERSION } from '../../shared/game/engine.ts'
import type { RunStatus } from '../../shared/api'

export const monadSurfAbi = parseAbi([
  'function relayer() view returns (address)',
  'function writeAvailable() view returns (bool)',
  'function getPlayer(bytes32 playerId) view returns ((uint64 bestScore, uint128 coins, uint64 runs, uint64 sessionExpiresAt, string pseudo))',
  'function getRun(bytes32 runId) view returns ((bytes32 playerId, bytes32 seed, bytes32 simulationVersion, bytes32 replayHash, uint64 createdAt, uint64 submittedBlock, uint64 score, uint64 coins, uint32 tickCount, string pseudo))',
  'function getLeaderboard() view returns ((bytes32 playerId, uint64 score, string pseudo)[])',
  'function savePlayer(bytes32 playerId, string pseudo)',
  'function revokeSession(bytes32 playerId)',
  'function startRun(bytes32 runId, bytes32 playerId, bytes32 seed, bytes32 simulationVersion)',
  'function submitRun(bytes32 runId, uint64 score, uint64 coins, uint32 tickCount, bytes inputs)',
  'event RunSubmitted(bytes32 indexed runId, bytes32 indexed playerId, uint64 score, uint64 coins, uint32 tickCount, bytes inputs)',
])

export const versionHash = keccak256(stringToHex(SIMULATION_VERSION))
export type ChainConfig = { monadRpcUrl: string; monadContractAddress: string; relayerPrivateKey: string }

export function chainReader(config: Pick<ChainConfig, 'monadRpcUrl' | 'monadContractAddress'>) {
  if (!config.monadRpcUrl || !isAddress(config.monadContractAddress) || /^0x0{40}$/i.test(config.monadContractAddress)) throw new Error('MONAD_NOT_CONFIGURED')
  const address = config.monadContractAddress as Hex
  const client = createPublicClient({ chain: monadTestnet, transport: http(config.monadRpcUrl, { timeout: 5000, retryCount: 0 }) })
  async function checkNetwork() {
    if (await client.getChainId() !== monadTestnet.id) throw new Error('WRONG_CHAIN')
  }
  async function player(id: Hex) { return client.readContract({ address, abi: monadSurfAbi, functionName: 'getPlayer', args: [id] }) }
  async function run(id: Hex) { return client.readContract({ address, abi: monadSurfAbi, functionName: 'getRun', args: [id] }) }
  async function status(id: Hex): Promise<RunStatus> {
    const saved = await run(id)
    if (saved.playerId === zeroHash) throw new Error('UNKNOWN_RUN')
    if (!saved.submittedBlock) return { runId: id, status: 'ready', transactionHash: null, error: null }
    const logs = await client.getContractEvents({ address, abi: monadSurfAbi, eventName: 'RunSubmitted', args: { runId: id }, fromBlock: saved.submittedBlock, toBlock: saved.submittedBlock, strict: true })
    const log = logs.find(entry => entry.args.playerId === saved.playerId && entry.args.score === saved.score && entry.args.coins === saved.coins && entry.args.tickCount === saved.tickCount && keccak256(entry.args.inputs) === saved.replayHash)
    if (!log) throw new Error('MISSING_RUN_EVENT')
    const head = await client.getBlockNumber({ cacheTime: 0 })
    const canonical = await client.getBlock({ blockNumber: saved.submittedBlock })
    if (canonical.hash !== log.blockHash) throw new Error('CHAIN_REORGANIZED')
    return { runId: id, status: head >= saved.submittedBlock + BigInt(1) ? 'confirmed' : 'submitted', transactionHash: log.transactionHash, error: null }
  }
  return { address, client, checkNetwork, player, run, status }
}

export function chainWriter(config: ChainConfig) {
  const chain = chainReader(config)
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.relayerPrivateKey)) throw new Error('RELAYER_NOT_CONFIGURED')
  const account = privateKeyToAccount(config.relayerPrivateKey as Hex)
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(config.monadRpcUrl, { timeout: 5000, retryCount: 0 }) })
  async function check() {
    await chain.checkNetwork()
    const relayer = await chain.client.readContract({ address: chain.address, abi: monadSurfAbi, functionName: 'relayer' })
    if (relayer.toLowerCase() !== account.address.toLowerCase()) throw new Error('WRONG_RELAYER')
  }
  async function write(data: Hex, applied: () => Promise<boolean>) {
    await check()
    const deadline = Date.now() + 35000
    let signed: { raw: Hex; hash: Hex; nonce: number } | undefined
    let failures = 0
    while (Date.now() < deadline) {
      if (await applied()) return
      const latest = await chain.client.getTransactionCount({ address: account.address, blockTag: 'latest' })
      if (signed && latest > signed.nonce) signed = undefined
      if (!signed) {
        const pending = await chain.client.getTransactionCount({ address: account.address, blockTag: 'pending' })
        if (pending > latest) {
          await new Promise(resolve => setTimeout(resolve, 700))
          continue
        }
        if (await applied()) return
        if (!await chain.client.readContract({ address: chain.address, abi: monadSurfAbi, functionName: 'writeAvailable' })) throw new Error('CHAIN_WRITE_LIMIT')
        try {
          const request = await wallet.prepareTransactionRequest({ to: chain.address, data, nonce: latest })
          if (request.gas * (request.maxFeePerGas ?? request.gasPrice ?? BigInt(0)) > BigInt('1000000000000000000')) throw new Error('FEE_LIMIT')
          const raw = await wallet.signTransaction(request)
          signed = { raw, hash: keccak256(raw), nonce: latest }
        } catch {
          if (await applied()) return
          if (++failures >= 3) throw new Error('TRANSACTION_REJECTED')
          await new Promise(resolve => setTimeout(resolve, 700))
          continue
        }
      }
      // Une réponse RPC perdue rediffuse les mêmes octets. Un nouveau nonce exige
      // la consommation du précédent et une nouvelle lecture de l'état onchain.
      try { await wallet.sendRawTransaction({ serializedTransaction: signed.raw }) } catch {}
      try {
        await chain.client.waitForTransactionReceipt({ hash: signed.hash, confirmations: 2, pollingInterval: 500, timeout: 3000 })
      } catch {}
      if (await applied()) return
    }
    throw new Error('TRANSACTION_NOT_CONFIRMED')
  }
  return { ...chain, check, write }
}
