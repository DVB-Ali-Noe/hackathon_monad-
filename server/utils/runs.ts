import { zeroHash } from 'viem'
import type { Hex } from 'viem'
import { chainReader, versionHash } from './contract.ts'
import type { ChainConfig } from './contract.ts'
import { fail } from './http.ts'
import { HEX_ID } from './replay.ts'

export async function ownedRun(config: ChainConfig, id: unknown, playerId: Hex) {
  if (typeof id !== 'string' || !HEX_ID.test(id)) fail(400, 'Identifiant de partie invalide.')
  const run = await chainReader(config).run(id as Hex)
  if (run.playerId === zeroHash || run.playerId !== playerId) fail(404, 'Partie introuvable.')
  if (run.simulationVersion !== versionHash) fail(409, 'Cette partie utilise une ancienne version du moteur.')
  return { ...run, id: id as Hex }
}
