import { itemDistance, itemLength } from './engine.ts'

export function safeLane(state, course) {
  const blocked = course.filter(item => item.kind !== 'coin'
    && itemDistance(item, state.tick + 8) <= state.distance + 2000
    && itemDistance(item, state.tick) + itemLength(item) > state.distance)
  return [state.lane, -1, 0, 1].find(lane => blocked.every(item => item.lane !== lane)) ?? 0
}
