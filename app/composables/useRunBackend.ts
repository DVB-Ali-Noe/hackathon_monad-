import type { LeaderboardSnapshot, PreparedRun, RunStatus, SessionInfo } from '../../shared/api'
import type { RunResult } from '../../shared/types'

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

  function cancel() {
    generation++
    if (timer) clearTimeout(timer)
    timer = undefined
    saving.value = false
  }

  async function prepare(pseudo: string): Promise<PreparedRun | null> {
    cancel()
    const current = generation
    pending = null
    submission.value = null
    saveError.value = ''
    notice.value = ''
    leaderboard.value = null
    leaderboardState.value = 'loading'
    const ranking = $fetch<LeaderboardSnapshot>('/api/leaderboard', { timeout: 7000, retry: 0 })
      .then((data) => {
        if (current !== generation) return
        leaderboard.value = data
        leaderboardState.value = 'ready'
      }).catch(() => { if (current === generation) leaderboardState.value = 'unavailable' })
    let run: PreparedRun | null = null
    try {
      const session = await $fetch<SessionInfo>('/api/session', { method: 'POST', body: { pseudo }, timeout: 7000, retry: 0 })
      if (current !== generation) return null
      playerId.value = session.playerId
      run = await $fetch<PreparedRun>('/api/runs', { method: 'POST', body: { requestKey: crypto.randomUUID() }, timeout: 7000, retry: 0 })
    } catch {
      if (current === generation) notice.value = 'Partie locale : l’enregistrement sur Monad est indisponible.'
    }
    await ranking
    return current === generation ? run : null
  }

  async function poll(runId: string, current: number) {
    try {
      const status = await $fetch<RunStatus>(`/api/runs/${runId}/relay`, { method: 'POST', body: {}, timeout: 25000, retry: 0 })
      if (current !== generation) return
      submission.value = status
      saveError.value = status.error || ''
      if (status.status === 'queued' || status.status === 'submitted') timer = setTimeout(() => { void poll(runId, current) }, 3000)
    } catch {
      if (current === generation) saveError.value = 'Le résultat est conservé par le serveur. Réessaie pour reprendre sa confirmation.'
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
      const status = await $fetch<RunStatus>('/api/run', { method: 'POST', body: result, timeout: 20000, retry: 0 })
      if (current !== generation) return
      submission.value = status
      saveError.value = status.error || ''
      if (status.status === 'queued' || status.status === 'submitted') void poll(result.runId, current)
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
      await $fetch('/api/session', { method: 'DELETE', body: {}, timeout: 7000, retry: 0 })
      playerId.value = ''
      return true
    } catch {
      if (!playerId.value) return true
      saveError.value = 'Le changement de joueur a échoué. Réessaie avant de commencer une autre partie.'
      return false
    }
  }

  onBeforeUnmount(cancel)
  return { playerId, leaderboard, leaderboardState, notice, submission, saving, saveError, prepare, submit, retry, changePlayer }
}
