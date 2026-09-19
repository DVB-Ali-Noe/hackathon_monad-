const actions = ['none', 'jump', 'crouch'] as const

export function parseMovement(body: Record<string, unknown>) {
  const { sequence, tick, lane, action } = body
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0 || sequence >= 108000) throw new Error('Séquence invalide.')
  if (typeof tick !== 'number' || !Number.isInteger(tick) || tick < 0 || tick >= 108000) throw new Error('Tick invalide.')
  if (lane !== -1 && lane !== 0 && lane !== 1) throw new Error('Couloir invalide.')
  if (action !== 'none' && action !== 'jump' && action !== 'crouch') throw new Error('Action invalide.')
  return { sequence, tick, input: (lane + 1) * 3 + actions.indexOf(action) }
}

export function decodeMovement(input: number) {
  return { lane: Math.floor(input / 3) - 1, action: actions[input % 3]! }
}
