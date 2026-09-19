import type { GameInput, RunConfig } from '../types'

export const SIMULATION_VERSION = 'runner-5-oncoming-60hz'
export const TICK_RATE = 60
export const JUMP_TICKS = 54
export const LANE_WIDTH = 2400
export const LANE_STEP = 1200
export const TRAIN_HEIGHT = 3000
export const TRAIN_LENGTH = 18000
export const RAMP_LENGTH = 4500
export const TRAIN_CLEARANCE = 1320
export const JUMP_GRACE_TICKS = 6
export const MOVING_RANGE = 60000
export const BARRIER_HEIGHT = 900
export const BARRIER_LENGTH = 1000

export type TrackItem = {
  id: number
  distance: number
  lane: GameInput['lane']
  kind: 'block' | 'jump' | 'crouch' | 'coin' | 'train'
  length?: number
  ramp?: boolean
  elevation?: number
  speed?: number
  encounterTick?: number
}

export type Course = TrackItem[] & { endDistance: number }

export type GameState = {
  tick: number
  distance: number
  speed: number
  x: number
  y: number
  lane: GameInput['lane']
  score: number
  coins: number
  lives: number
  jumpTicks: number
  jumpHeld: boolean
  jumpOriginY: number
  coyoteTicks: number
  coyoteY: number
  jumpBufferTicks: number
  fallVelocity: number
  grounded: boolean
  supportId: number | null
  crouching: boolean
  invulnerableTicks: number
  status: 'running' | 'finished'
}

function randomGenerator(seed: string) {
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619)
  state = state >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function nominalDistance(tick: number): number {
  const steps = Math.min(100, Math.floor(tick / 45))
  return tick * 200 + 45 * steps * (steps - 1) / 2 + steps * (tick - steps * 45)
}

function tickAtDistance(distance: number): number {
  let low = 0, high = Math.ceil(distance / 200)
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (nominalDistance(middle) < distance) low = middle + 1
    else high = middle
  }
  return low
}

export function itemDistance(item: TrackItem, tick: number): number {
  return item.distance + Math.max(-MOVING_RANGE, Math.min(MOVING_RANGE, ((item.encounterTick ?? 0) - tick) * (item.speed ?? 0)))
}

export function itemLength(item: TrackItem): number {
  return item.length ?? (item.kind === 'train' ? TRAIN_LENGTH : item.kind === 'jump' ? BARRIER_LENGTH : 0)
}

export function createCourse(config: RunConfig, fromDistance = 0): Course {
  if (config.simulationVersion !== SIMULATION_VERSION) throw new Error('Version de simulation incompatible')
  if (typeof config.seed !== 'string' || !config.seed.length || config.seed.length > 128) throw new Error('Graine invalide')
  if (!Number.isSafeInteger(fromDistance) || fromDistance < 0) throw new Error('Distance invalide')
  const items: TrackItem[] = []
  const kinds = ['jump', 'crouch', 'train', 'train', 'train', 'train'] as const
  const end = fromDistance + 180000
  const firstRow = Math.max(0, Math.floor((fromDistance - 39000 - MOVING_RANGE) / 24000))
  // Chaque rangée possède sa graine : la fenêtre peut avancer sans conserver le passé.
  for (let row = firstRow; 21000 + row * 24000 <= end + MOVING_RANGE; row++) {
    const random = randomGenerator(`${config.seed}:${row}`)
    const distance = 30000 + row * 24000 + Math.floor(random() * 3000)
    let id = row * 16
    const safeLane = (Math.floor(random() * 3) - 1) as GameInput['lane']
    const blocked = ([-1, 0, 1] as const).filter(lane => lane !== safeLane)
    const firstLane = blocked[Math.floor(random() * blocked.length)]!
    const kind = row % 4 === 0 ? 'train' : kinds[Math.floor(random() * kinds.length)]!
    const ramp = row % 4 === 0 || random() > 0.4
    items.push({ id: id++, distance, lane: firstLane, kind, ...(kind === 'train' ? { length: TRAIN_LENGTH, ramp } : kind === 'jump' ? { length: BARRIER_LENGTH } : {}) })
    if (row > 0 && (row % 2 === 1 || random() > 0.3)) {
      items.push({ id: id++, distance, lane: blocked.find(lane => lane !== firstLane)!, kind: 'train', length: TRAIN_LENGTH, ramp: false, ...(row % 2 ? { speed: 100, encounterTick: tickAtDistance(distance) } : {}) })
    }
    for (let offset = -9000; offset <= 6000; offset += 3000) {
      items.push({ id: id++, distance: distance + offset, lane: safeLane, kind: 'coin' })
    }
    if (kind === 'train') {
      for (let offset = 6000; offset <= 15000; offset += 3000) {
        items.push({ id: id++, distance: distance + offset, lane: firstLane, kind: 'coin', elevation: TRAIN_HEIGHT })
      }
    }
  }
  return Object.assign(items.filter(item => item.distance + itemLength(item) + (item.speed ? MOVING_RANGE : 0) > fromDistance
    && item.distance - (item.speed ? MOVING_RANGE : 0) <= end)
    .sort((a, b) => a.distance - b.distance || a.id - b.id), { endDistance: end })
}

export function updateCourse(config: RunConfig, course: Course, distance: number): Course {
  return course.endDistance < distance + 120000
    ? createCourse(config, Math.max(0, distance - 2000)) : course
}

export function createState(): GameState {
  return {
    tick: 0, distance: 0, speed: 200, x: 0, y: 0, lane: 0, score: 0, coins: 0, lives: 3,
    jumpTicks: 0, jumpHeld: false, crouching: false, invulnerableTicks: 0,
    jumpOriginY: 0, fallVelocity: 0, grounded: true, supportId: null,
    coyoteTicks: 0, coyoteY: 0, jumpBufferTicks: 0,
    status: 'running',
  }
}

export function jumpHeight(state: Pick<GameState, 'jumpTicks'>): number {
  return Math.round(4 * 2200 * state.jumpTicks * (JUMP_TICKS - state.jumpTicks) / (JUMP_TICKS * JUMP_TICKS))
}

export function trainSurface(item: TrackItem, distance: number, tick = 0): number {
  return item.ramp ? Math.round(TRAIN_HEIGHT * Math.min(1, Math.max(0, (distance - itemDistance(item, tick)) / RAMP_LENGTH))) : TRAIN_HEIGHT
}

function surfaceHeight(item: TrackItem, distance: number, tick: number): number {
  return item.kind === 'train' ? trainSurface(item, distance, tick) : BARRIER_HEIGHT + (item.elevation ?? 0)
}

export function isGameInput(input: unknown): input is GameInput {
  if (!input || typeof input !== 'object') return false
  const value = input as GameInput
  return (value.lane === -1 || value.lane === 0 || value.lane === 1)
    && (value.action === 'none' || value.action === 'jump' || value.action === 'crouch')
}

export function stepGame(state: GameState, input: GameInput, course: readonly TrackItem[]): GameState {
  if (!isGameInput(input)) throw new Error('Commande invalide')
  if (state.status === 'finished') return state
  const next: GameState = {
    ...state, tick: state.tick + 1, lane: input.lane,
    speed: Math.min(300, 200 + Math.floor(state.tick / 45)),
    invulnerableTicks: Math.max(0, state.invulnerableTicks - 1),
    jumpTicks: Math.max(0, state.jumpTicks - 1), jumpHeld: input.action === 'jump',
    coyoteTicks: state.grounded ? JUMP_GRACE_TICKS : Math.max(0, state.coyoteTicks - 1),
    coyoteY: state.grounded ? state.y : state.coyoteY,
    jumpBufferTicks: input.action === 'jump' && !state.jumpHeld ? JUMP_GRACE_TICKS : Math.max(0, state.jumpBufferTicks - 1),
  }
  const target = input.lane * LANE_WIDTH
  next.x += Math.sign(target - next.x) * Math.min(LANE_STEP, Math.abs(target - next.x))
  if (next.jumpBufferTicks > 0 && state.jumpTicks === 0 && (state.grounded || next.coyoteTicks > 0)) {
    next.jumpTicks = JUMP_TICKS
    next.jumpOriginY = state.grounded ? state.y : state.coyoteY
    next.coyoteTicks = 0
    next.jumpBufferTicks = 0
  }
  next.distance += next.speed

  if (next.jumpTicks > 0 || state.jumpTicks > 0) {
    next.y = next.jumpOriginY + jumpHeight(next)
    next.fallVelocity = Math.max(0, state.y - next.y)
  } else if (!state.grounded) {
    next.fallVelocity += 6
    next.y -= next.fallVelocity
  }
  next.grounded = false
  next.supportId = null
  const descending = next.jumpTicks <= JUMP_TICKS / 2
  function hit() {
    if (next.invulnerableTicks === 0) {
      next.lives--
      next.invulnerableTicks = 72
    }
  }

  // Les réceptions se comparent à la surface aux deux ticks : une rampe peut
  // monter sous les pieds pendant la descente, sans devenir un impact frontal.
  function canLand(item: TrackItem, height: number) {
    return (descending || item.ramp && height < TRAIN_HEIGHT) && state.y >= surfaceHeight(item, state.distance, state.tick) - 30 && next.y <= height
  }
  function canWalk(item: TrackItem, height: number) {
    return next.jumpTicks === 0 && state.grounded
      && (state.supportId === item.id || Math.abs(state.y - height) <= 220)
  }

  for (const item of course) {
    if (item.kind !== 'train' && item.kind !== 'jump') continue
    const front = itemDistance(item, next.tick)
    if (next.distance < front || next.distance >= front + itemLength(item)) continue
    const center = item.lane * LANE_WIDTH
    const clearance = item.kind === 'train' ? TRAIN_CLEARANCE : 1200
    if (Math.abs(next.x - center) >= clearance) continue
    const height = surfaceHeight(item, next.distance, next.tick)
    if (next.y >= height - 30 || canWalk(item, height) || canLand(item, height)) continue
    hit()
    if (Math.abs(state.x - center) >= clearance || state.distance > itemDistance(item, state.tick)) {
      const side = Math.sign(state.x - center) || Math.sign(next.x - center) || 1
      next.x = center + side * Math.max(clearance, Math.abs(state.x - center))
      next.invulnerableTicks = Math.max(2, next.invulnerableTicks)
    } else {
      next.distance = front - 1
      // Un train arrivant en sens inverse ne peut pas attendre le joueur.
      if (item.speed) next.lives = 0
    }
  }

  let surface = 0
  let support: TrackItem | null = null
  for (const item of course) {
    if (item.kind !== 'train' && item.kind !== 'jump') continue
    const front = itemDistance(item, next.tick)
    if (next.distance < front || next.distance >= front + itemLength(item)
      || Math.abs(next.x - item.lane * LANE_WIDTH) >= (item.kind === 'train' ? TRAIN_CLEARANCE : 1200)) continue
    const height = surfaceHeight(item, next.distance, next.tick)
    if (height >= surface && (canWalk(item, height) || canLand(item, height))) {
      surface = height
      support = item
    }
  }
  if (support || (next.y <= 0 && descending)) {
    next.y = surface
    next.grounded = true
    next.supportId = support?.id ?? null
    next.jumpTicks = 0
    next.fallVelocity = 0
    next.coyoteTicks = JUMP_GRACE_TICKS
    next.coyoteY = next.y
  }
  next.crouching = next.grounded && input.action === 'crouch'

  for (const item of course) {
    if (item.distance > next.distance) break
    if (Math.abs(next.x - item.lane * LANE_WIDTH) >= 1000) continue
    if (item.kind === 'train' || item.kind === 'jump') continue
    if (item.distance <= state.distance) continue
    const height = next.y - (item.elevation ?? 0)
    if (item.kind === 'coin') {
      if (Math.abs(height) < 900) next.coins++
      continue
    }
    const avoided = height >= 3000 || height < -2000
      || item.kind === 'crouch' && (next.crouching || height >= 2200)
    if (!avoided) hit()
  }
  next.score = Math.floor(next.distance / 1000) * 10 + next.coins * 25
  if (next.lives <= 0) next.status = 'finished'
  return next
}

export function replayRun(config: RunConfig, inputs: readonly GameInput[]): GameState {
  if (!Array.isArray(inputs)) throw new Error('Commandes de rejeu invalides')
  let course = createCourse(config)
  let state = createState()
  for (const input of inputs) {
    if (state.status === 'finished') throw new Error('Commandes après la fin de partie')
    course = updateCourse(config, course, state.distance)
    state = stepGame(state, input, course)
  }
  return state
}
