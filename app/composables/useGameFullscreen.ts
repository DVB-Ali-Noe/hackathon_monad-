import type { Ref } from 'vue'

export function useGameFullscreen(target: Ref<HTMLElement | null>, onExit?: () => void) {
  const fullscreen = ref(false)
  const fullscreenError = ref('')
  let disposed = false

  function changed() {
    const wasFullscreen = fullscreen.value
    fullscreen.value = document.fullscreenElement === target.value
    if (wasFullscreen && !fullscreen.value) onExit?.()
  }

  async function toggleFullscreen() {
    const element = target.value
    if (!element) return
    fullscreenError.value = ''
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen()
      else if (element.requestFullscreen) {
        await element.requestFullscreen()
        if (disposed && document.fullscreenElement === element) await document.exitFullscreen()
      } else fullscreenError.value = 'Le plein écran n’est pas disponible dans ce navigateur.'
    } catch {
      fullscreenError.value = 'Le navigateur a refusé le plein écran. Tu peux continuer dans cette fenêtre.'
    }
  }

  onMounted(() => document.addEventListener('fullscreenchange', changed))
  onBeforeUnmount(() => {
    disposed = true
    document.removeEventListener('fullscreenchange', changed)
    if (target.value && document.fullscreenElement === target.value) void document.exitFullscreen().catch(() => {})
  })
  return { fullscreen, fullscreenError, toggleFullscreen }
}
