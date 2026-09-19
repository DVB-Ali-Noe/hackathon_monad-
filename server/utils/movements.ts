import { encodeFunctionData, keccak256, parseAbi } from 'viem'
import type { Hex } from 'viem'
import { chainReader, chainWriter, monadSurfAbi } from './contract.ts'
import type { ChainConfig } from './contract.ts'
import { decodeMovement } from './movement-input.ts'
import type { parseMovement } from './movement-input.ts'
import type { ownedRun } from './runs.ts'
import { fail } from './http.ts'

export const monadMovesAbi = parseAbi([
  'function game() view returns (address)',
  'function movementAvailable(bytes32 playerId) view returns (bool)',
  'function getProgress(bytes32 runId) view returns ((bytes32 historyHash, uint32 count, uint32 lastTick, uint8 lastInput))',
  'function getMovement(bytes32 runId, uint32 sequence) view returns ((uint32 tick, uint8 input, uint64 recordedBlock))',
  'function recordMovement(bytes32 runId, uint32 sequence, uint32 tick, uint8 input)',
  'event MovementRecorded(bytes32 indexed runId, uint32 indexed sequence, uint32 tick, uint8 input, bytes32 historyHash)',
])

type MovesConfig = ChainConfig & { monadMovesAddress: string; movesRelayerPrivateKey: string }

export function movementReader(config: MovesConfig) {
  if (!config.monadMovesAddress) fail(503, 'Le journal des mouvements n’est pas configuré.')
  const chain = chainReader({ ...config, monadContractAddress: config.monadMovesAddress })
  async function check() {
    await chain.checkNetwork()
    const game = await chain.client.readContract({ address: chain.address, abi: monadMovesAbi, functionName: 'game' })
    if (game.toLowerCase() !== config.monadContractAddress.toLowerCase()) throw new Error('WRONG_MOVEMENT_GAME')
  }
  const progress = (runId: Hex) => chain.client.readContract({ address: chain.address, abi: monadMovesAbi, functionName: 'getProgress', args: [runId] })
  const movement = (runId: Hex, sequence: number) => chain.client.readContract({ address: chain.address, abi: monadMovesAbi, functionName: 'getMovement', args: [runId, sequence] })
  async function receipt(runId: Hex, sequence: number) {
    const saved = await movement(runId, sequence)
    if (!saved.recordedBlock) fail(404, 'Mouvement non enregistré.')
    const logs = await chain.client.getContractEvents({ address: chain.address, abi: monadMovesAbi, eventName: 'MovementRecorded', args: { runId, sequence }, fromBlock: saved.recordedBlock, toBlock: saved.recordedBlock, strict: true })
    const log = logs.find(entry => entry.args.tick === saved.tick && entry.args.input === saved.input)
    if (!log) throw new Error('MISSING_MOVEMENT_EVENT')
    const [block, head] = await Promise.all([chain.client.getBlock({ blockNumber: saved.recordedBlock }), chain.client.getBlockNumber({ cacheTime: 0 })])
    if (block.hash !== log.blockHash) throw new Error('CHAIN_REORGANIZED')
    return { runId, sequence, tick: saved.tick, ...decodeMovement(saved.input), historyHash: log.args.historyHash,
      transactionHash: log.transactionHash, blockNumber: saved.recordedBlock.toString(), status: head > saved.recordedBlock ? 'confirmed' : 'included' }
  }
  return { ...chain, check, progress, movement, receipt }
}

export async function recordMovement(config: MovesConfig, run: Awaited<ReturnType<typeof ownedRun>>, input: ReturnType<typeof parseMovement>) {
  const journal = movementReader(config)
  await journal.check()
  async function applied() {
    const saved = await journal.movement(run.id, input.sequence)
    if (!saved.recordedBlock) return false
    if (saved.tick !== input.tick || saved.input !== input.input) fail(409, 'Cette séquence contient déjà un autre mouvement.')
    return true
  }
  if (await applied()) return journal.receipt(run.id, input.sequence)
  if (Number(run.createdAt) * 1000 + 86400000 < Date.now()) fail(410, 'Cette partie a expiré.')
  const progress = await journal.progress(run.id)
  if (input.sequence !== progress.count) fail(409, `Séquence attendue : ${progress.count}.`)
  if (progress.count && input.tick <= progress.lastTick) fail(422, 'Les ticks doivent être strictement croissants.')
  if (input.input === progress.lastInput) fail(422, 'Envoyer uniquement les changements de commande.')
  if ((input.tick + 1) / 60 > (Date.now() - Number(run.createdAt) * 1000) / 1000 + 2) fail(422, 'Ce tick dépasse la durée réelle de la partie.')
  if (run.submittedBlock) {
    if (input.tick >= run.tickCount) fail(422, 'Ce mouvement dépasse la fin de la partie.')
    const game = chainReader(config)
    const logs = await game.client.getContractEvents({ address: game.address, abi: monadSurfAbi, eventName: 'RunSubmitted', args: { runId: run.id }, fromBlock: run.submittedBlock, toBlock: run.submittedBlock, strict: true })
    const replay = logs.find(log => log.args.playerId === run.playerId && keccak256(log.args.inputs) === run.replayHash)?.args.inputs
    if (!replay) throw new Error('MISSING_RUN_EVENT')
    const current = Number.parseInt(replay.slice(2 + input.tick * 2, 4 + input.tick * 2), 16)
    const previous = input.tick === 0 ? 3 : Number.parseInt(replay.slice(input.tick * 2, 2 + input.tick * 2), 16)
    if (current !== input.input || current === previous) fail(422, 'Ce mouvement ne correspond pas au replay enregistré.')
  }
  if (!await journal.client.readContract({ address: journal.address, abi: monadMovesAbi, functionName: 'movementAvailable', args: [run.playerId] })) throw new Error('CHAIN_WRITE_LIMIT')
  const writer = chainWriter({ ...config, monadContractAddress: config.monadMovesAddress, relayerPrivateKey: config.movesRelayerPrivateKey })
  await writer.write(encodeFunctionData({ abi: monadMovesAbi, functionName: 'recordMovement', args: [run.id, input.sequence, input.tick, input.input] }), applied, { confirmations: 1, maxCost: BigInt('100000000000000000') })
  return journal.receipt(run.id, input.sequence)
}
