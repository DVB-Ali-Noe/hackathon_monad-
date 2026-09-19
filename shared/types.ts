export type GameInput = {
  lane: -1 | 0 | 1
  action: 'none' | 'jump' | 'crouch'
}

export type RunConfig = {
  seed: string
  simulationVersion: string
}

export type RunResult = RunConfig & {
  runId: string
  pseudo: string
  score: number
  coins: number
  tickCount: number
  inputs: GameInput[]
}

export type Ghost = RunConfig & {
  pseudo: string
  score: number
  tickCount: number
  inputs: GameInput[]
}
