import type { GameInput } from '../../shared/types'

export type Landmark = { x: number, y: number, visibility: number }

export type Pose = {
  hipX: number
  hipY: number
  shoulderY: number
  shoulderWidth: number
  leftFootY: number
  rightFootY: number
  height: number
  standing: boolean
}

export type Calibration = {
  reference: Pose | null
  samples: Pose[]
  since: number | null
  lastTime: number | null
  progress: number
  hint: string
}

export type Movement = {
  input: GameInput
  tracking: 'lost' | 'recovering' | 'tracked'
  filtered: Pose | null
  lastTime: number | null
  foundSince: number | null
  laneCandidate: GameInput['lane']
  laneSince: number
  laneReady: boolean
  laneCenterSince: number | null
  actionCandidate: GameInput['action']
  actionSince: number
  jumpArmed: boolean
  jumpUntil: number
  groundedSince: number | null
  crouchActive: boolean
  crouchReleaseSince: number | null
}

const bodyPoints = [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
const neutral = (): GameInput => ({ lane: 0, action: 'none' })

export function readPose(points: Landmark[], aspectRatio = 4 / 3, reference: Pose | null = null): Pose | null {
  const isVisible = (index: number) => {
    const point = points[index]
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.visibility >= 0.6 && point.x > 0.02 && point.x < 0.98
      && point.y > 0.02 && point.y < 0.98
  }
  // La tête mesure la taille à la calibration ; son cadrage ne doit plus
  // interrompre un saut quand le tronc et les pieds restent suivis.
  if (!(reference ? [11, 12, 23, 24] : bodyPoints).every(isVisible)) return null

  const point = (index: number) => points[index]!
  const hipX = (point(23).x + point(24).x) / 2
  const hipY = (point(23).y + point(24).y) / 2
  const shoulderY = (point(11).y + point(12).y) / 2
  const shoulderWidth = Math.abs(point(11).x - point(12).x)
  const footPosition = (indices: number[]) => {
    const visible = indices.filter(isVisible)
    return visible.length >= 2 ? Math.max(...visible.map(index => point(index).y)) : NaN
  }
  const leftFootY = footPosition([27, 29, 31])
  const rightFootY = footPosition([28, 30, 32])
  if (!Number.isFinite(leftFootY) || !Number.isFinite(rightFootY)) return null
  const footY = (leftFootY + rightFootY) / 2
  const height = reference?.height ?? footY - point(0).y
  if (height < 0.35 || shoulderWidth < 0.06 || shoulderY >= hipY || hipY >= footY) return null

  const legStraight = (hip: number, knee: number, ankle: number) => {
    if (!isVisible(knee) || !isVisible(ankle)) return false
    const a = point(hip)
    const b = point(knee)
    const c = point(ankle)
    const ux = (a.x - b.x) * aspectRatio
    const uy = a.y - b.y
    const vx = (c.x - b.x) * aspectRatio
    const vy = c.y - b.y
    const cosine = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))
    return cosine < -0.9
  }

  return {
    hipX, hipY, shoulderY, shoulderWidth, leftFootY, rightFootY, height,
    standing: legStraight(23, 25, 27) && legStraight(24, 26, 28)
      && (footY - hipY) / height > 0.4,
  }
}

export function createCalibration(): Calibration {
  return {
    reference: null, samples: [], since: null, lastTime: null, progress: 0,
    hint: 'Place-toi debout au centre, tête et pieds visibles.',
  }
}

export function calibrate(state: Calibration, pose: Pose | null, time: number): Calibration {
  if (state.reference) return state
  if (!pose) return createCalibration()
  if (!pose.standing || Math.abs(pose.hipX - 0.5) > 0.08) {
    return { ...createCalibration(), hint: 'Tiens-toi droit, les deux pieds au sol, au centre du cadre.' }
  }

  const first = state.samples[0]
  const interrupted = state.lastTime !== null && (time - state.lastTime > 250 || time <= state.lastTime)
  const moved = first && (
    Math.abs(pose.hipX - first.hipX) > first.shoulderWidth * 0.12
    || Math.abs(pose.hipY - first.hipY) > first.height * 0.025
    || Math.abs(pose.shoulderY - first.shoulderY) > first.height * 0.025
    || Math.abs(pose.leftFootY - first.leftFootY) > first.height * 0.025
    || Math.abs(pose.rightFootY - first.rightFootY) > first.height * 0.025
    || Math.abs(pose.height - first.height) > first.height * 0.05
  )
  const samples = interrupted || moved ? [pose] : [...state.samples, pose]
  const since = interrupted || moved ? time : state.since ?? time
  const progress = Math.min((time - since) / 1800, samples.length / 18, 1)
  let reference: Pose | null = null
  if (progress === 1) {
    const average = (key: Exclude<keyof Pose, 'standing'>) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length
    reference = {
      hipX: average('hipX'), hipY: average('hipY'), shoulderY: average('shoulderY'),
      shoulderWidth: average('shoulderWidth'), leftFootY: average('leftFootY'),
      rightFootY: average('rightFootY'), height: average('height'), standing: true,
    }
  }
  return {
    reference, samples: reference ? [] : samples, since, lastTime: time, progress,
    hint: reference ? 'Calibration terminée. Essaie les mouvements.' : 'Reste immobile un instant…',
  }
}

export function createMovement(): Movement {
  return {
    input: neutral(), tracking: 'lost', filtered: null, lastTime: null, foundSince: null,
    laneCandidate: 0, laneSince: 0, actionCandidate: 'none', actionSince: 0,
    laneReady: true, laneCenterSince: null,
    jumpArmed: false, jumpUntil: 0, groundedSince: null,
    crouchActive: false, crouchReleaseSince: null,
  }
}

export function recognize(state: Movement, pose: Pose | null, reference: Pose, time: number): Movement {
  if (!pose) return createMovement()
  if (state.lastTime !== null && time <= state.lastTime) return state
  const previous = state.lastTime !== null && time - state.lastTime > 300 ? createMovement() : state
  const alpha = 1 - Math.exp(-Math.min(time - (previous.lastTime ?? time - 100), 150) / 30)
  const lateralAlpha = 1 - Math.exp(-Math.min(time - (previous.lastTime ?? time - 100), 150) / 10)
  const smooth = (key: Exclude<keyof Pose, 'standing'>) => {
    const last = previous.filtered?.[key] ?? pose[key]
    return last + alpha * (pose[key] - last)
  }
  const filtered: Pose = {
    ...pose, hipX: (previous.filtered?.hipX ?? pose.hipX) + lateralAlpha * (pose.hipX - (previous.filtered?.hipX ?? pose.hipX)),
    hipY: smooth('hipY'), shoulderY: smooth('shoulderY'),
    leftFootY: smooth('leftFootY'), rightFootY: smooth('rightFootY'),
  }
  const next: Movement = { ...previous, filtered, lastTime: time, foundSince: previous.foundSince ?? time }
  if (time - next.foundSince! < 200) {
    return { ...next, tracking: 'recovering', input: neutral() }
  }
  next.tracking = 'tracked'

  // La vidéo est analysée brute ; le couloir suit les coordonnées de l'aperçu miroir.
  const lateral = (reference.hipX - filtered.hipX) / reference.shoulderWidth
  let lane: GameInput['lane'] = 0
  if (lateral < -0.65 || (previous.input.lane === -1 && lateral < -0.38)) lane = -1
  if (lateral > 0.65 || (previous.input.lane === 1 && lateral > 0.38)) lane = 1
  next.laneCenterSince = Math.abs(lateral) < 0.38 ? previous.laneCenterSince ?? time : null
  if (next.laneCenterSince !== null && time - next.laneCenterSince >= 90) next.laneReady = true
  // Une traversée rapide ou un rebond doit s'arrêter au centre avant un autre couloir.
  if (previous.input.lane !== 0 && lane !== previous.input.lane) lane = 0
  if (previous.input.lane === 0 && !next.laneReady) lane = 0
  if (lane !== previous.laneCandidate) {
    next.laneCandidate = lane
    next.laneSince = time
  }
  const confirmedLane = time - next.laneSince >= 12 ? lane : previous.input.lane
  if (confirmedLane === 0 && previous.input.lane !== 0) next.laneReady = false

  const hipRise = (reference.hipY - filtered.hipY) / reference.height
  const shoulderRise = (reference.shoulderY - filtered.shoulderY) / reference.height
  const leftRise = (reference.leftFootY - filtered.leftFootY) / reference.height
  const rightRise = (reference.rightFootY - filtered.rightFootY) / reference.height
  // Le décollage est bref : deux observations brutes évitent le retard du lissage
  // et empêchent sa traîne de transformer un artefact isolé en saut confirmé.
  const airborne = (reference.hipY - pose.hipY) / reference.height > 0.025
    && (reference.shoulderY - pose.shoulderY) / reference.height > 0.02
    && (reference.leftFootY - pose.leftFootY) / reference.height > 0.012
    && (reference.rightFootY - pose.rightFootY) / reference.height > 0.012
  const grounded = !airborne && time >= previous.jumpUntil
    && Math.abs(leftRise) < 0.025 && Math.abs(rightRise) < 0.025
    && Math.abs(hipRise) < 0.045 && Math.abs(shoulderRise) < 0.06
  next.groundedSince = grounded ? previous.groundedSince ?? time : null
  if (next.groundedSince !== null && time - next.groundedSince >= 160) next.jumpArmed = true

  const crouched = hipRise < -0.12
    && shoulderRise < -0.07 && Math.abs(leftRise) < 0.06 && Math.abs(rightRise) < 0.06
  const candidate = crouched ? 'crouch' : airborne && next.jumpArmed ? 'jump' : 'none'
  if (candidate !== previous.actionCandidate) {
    next.actionCandidate = candidate
    next.actionSince = time
  }
  if (candidate === 'crouch' && time - next.actionSince >= 20) next.crouchActive = true
  // Le maintien dépend du redressement, pas du seuil plus strict d'entrée.
  const upright = hipRise > -0.05 && shoulderRise > -0.045
  next.crouchReleaseSince = next.crouchActive && upright ? previous.crouchReleaseSince ?? time : null
  if (next.crouchReleaseSince !== null && time - next.crouchReleaseSince >= 160) {
    next.crouchActive = false
    next.crouchReleaseSince = null
  }
  // Une impulsion par saut ; seul un retour debout au sol réarme le geste.
  if (candidate === 'jump' && time - next.actionSince >= 12) {
    next.jumpUntil = time + 180
    next.jumpArmed = false
    next.crouchActive = false
    next.crouchReleaseSince = null
  }
  const action = time < next.jumpUntil ? 'jump'
    : next.crouchActive ? 'crouch' : 'none'
  next.input = { lane: confirmedLane, action }
  return next
}
