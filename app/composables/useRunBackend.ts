import type { LeaderboardSnapshot, PreparedRun, RunStatus, SessionInfo } from '../../shared/api'
import type { RunResult } from '../../shared/types'
import { parseLeaderboard } from '../utils/leaderboard.ts'

export function useRunBackend() {
  const playerId = ref('')
  const leaderboard = shallowRef<LeaderboardSnapshot | null>(null)
  const leaderboardState = ref<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const notice = ref('')
  const submission = shallowRef<RunStatus | null>(null)
  const saving = ref(false)
  const saveError = ref('')
  let pending: RunResult | null = null
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let rankingGeneration = 0
  let rankingRequest: Promise<void> | undefined
  let hasPrepared = false

  function cancel() {
    generation++
    if (timer) clearTimeout(timer)
    timer = undefined
    saving.value = false
  }

  function refreshLeaderboard(fresh = false): Promise<void> {
    if (!fresh && rankingRequest) return rankingRequest
    const current = ++rankingGeneration
    leaderboard.value = null
    leaderboardState.value = 'loading'
    rankingRequest = $fetch<unknown>('/api/leaderboard', { timeout: 7000, retry: 0 })
      .then(parseLeaderboard)
      .then((data) => {
        if (current !== rankingGeneration) return
        leaderboard.value = data
        leaderboardState.value = 'ready'
      }).catch(() => { if (current === rankingGeneration) leaderboardState.value = 'unavailable' })
      .finally(() => { if (current === rankingGeneration) rankingRequest = undefined })
    return rankingRequest
  }

  function updateSubmission(status: RunStatus) {
    const newlyConfirmed = status.status === 'confirmed' && submission.value?.status !== 'confirmed'
    submission.value = status
    saveError.value = status.error || ''
    if (newlyConfirmed) void refreshLeaderboard(true)
  }

  async function prepare(pseudo: string): Promise<PreparedRun | null> {
    cancel()
    const current = generation
    pending = null
    submission.value = null
    saveError.value = ''
    notice.value = ''
    const ranking = refreshLeaderboard(hasPrepared)
    hasPrepared = true
    let run: PreparedRun | null = null
    try {
      const session = await $fetch<SessionInfo>('/api/session', { method: 'POST', body: { pseudo }, timeout: 55000, retry: 0 })
      if (current !== generation) return null
      playerId.value = session.playerId
      run = await $fetch<PreparedRun>('/api/runs', { method: 'POST', body: { requestKey: crypto.randomUUID() }, timeout: 55000, retry: 0 })
    } catch {
      if (current === generation) notice.value = 'Partie locale : l’enregistrement sur Monad est indisponible.'
    }
    await ranking
    return current === generation ? run : null
  }

  async function poll(runId: string, current: number) {
    try {
      const status = await $fetch<RunStatus>(`/api/runs/${runId}`, { timeout: 15000, retry: 0 })
      if (current !== generation) return
      updateSubmission(status)
      if (status.status === 'submitted') timer = setTimeout(() => { void poll(runId, current) }, 3000)
    } catch {
      if (current === generation) saveError.value = 'La confirmation sur Monad est indisponible. Réessaie pour vérifier la transaction.'
    }
  }

  async function submit(result: RunResult) {
    if (saving.value) return
    if (timer) clearTimeout(timer)
    if (result.runId.startsWith('local-')) return
    const current = generation
    pending = result
    saving.value = true
    saveError.value = ''
    try {
      const status = await $fetch<RunStatus>('/api/run', { method: 'POST', body: result, timeout: 55000, retry: 0 })
      if (current !== generation) return
      updateSubmission(status)
      if (status.status === 'submitted') void poll(result.runId, current)
    } catch (error) {
      if (current !== generation) return
      const message = (error as { data?: { data?: { message?: string } } }).data?.data?.message
      saveError.value = message || 'L’enregistrement n’a pas pu être vérifié. Tu peux réessayer sans doubler les récompenses.'
    } finally { if (current === generation) saving.value = false }
  }

  function retry() { if (pending) void submit(pending) }

  async function changePlayer() {
    cancel()
    try {
      await $fetch('/api/session', { method: 'DELETE', body: {}, timeout: 55000, retry: 0 })
      playerId.value = ''
      return true
    } catch {
      if (!playerId.value) return true
      saveError.value = 'Le changement de joueur a échoué. Réessaie avant de commencer une autre partie.'
      return false
    }
  }

  onBeforeUnmount(() => { cancel(); rankingGeneration++; rankingRequest = undefined })
  return { playerId, leaderboard, leaderboardState, notice, submission, saving, saveError, prepare, submit, retry, changePlayer, refreshLeaderboard }
}
