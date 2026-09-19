import { createCourse, createState, stepGame, updateCourse } from '../shared/game/engine.ts'

export function finishedRun(config, lane = 0) {
  let state = createState()
  let course = createCourse(config)
  const inputs = []
  while (state.status !== 'finished' && inputs.length < 10000) {
    const input = { lane, action: 'none' }
    course = updateCourse(config, course, state.distance)
    state = stepGame(state, input, course)
    inputs.push(input)
  }
  if (state.status !== 'finished') throw new Error('Fixture non terminée')
  return { runId: config.runId, pseudo: config.pseudo, seed: config.seed, simulationVersion: config.simulationVersion,
    score: state.score, coins: state.coins, tickCount: state.tick, inputs }
}
